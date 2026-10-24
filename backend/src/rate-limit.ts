import type { Redis } from 'ioredis';

// Atomic across all worker instances. Redis TIME avoids host clock skew.
// Fixed UTC hour windows; reservations count attempts conservatively.
export const RATE_SCRIPT = `
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local hour = math.floor(now / 3600000)
local boundary = (hour + 1) * 3600000
local senderKey = KEYS[1] .. ':' .. hour
local campaignKey = KEYS[2] .. ':' .. hour
local senderCount = tonumber(redis.call('GET', senderKey) or '0')
local campaignCount = tonumber(redis.call('GET', campaignKey) or '0')
local senderLimit = tonumber(ARGV[1])
local campaignLimit = tonumber(ARGV[2])
if senderCount >= senderLimit then return {0, boundary, 1, senderLimit, hour} end
if campaignCount >= campaignLimit then return {0, boundary, 1, campaignLimit, hour} end
local globalNext = tonumber(redis.call('GET', KEYS[3]) or '0')
local senderNext = tonumber(redis.call('GET', KEYS[4]) or '0')
local nextTime = math.max(globalNext, senderNext)
if nextTime > now then return {0, nextTime, 0, 0, hour} end
redis.call('SET', KEYS[3], now + tonumber(ARGV[3]), 'PX', tonumber(ARGV[3]))
redis.call('SET', KEYS[4], now + tonumber(ARGV[4]), 'PX', tonumber(ARGV[4]))
redis.call('INCR', senderKey)
redis.call('PEXPIREAT', senderKey, boundary + 3600000)
redis.call('INCR', campaignKey)
redis.call('PEXPIREAT', campaignKey, boundary + 3600000)
local reached = 0
local limit = senderLimit
if senderCount + 1 >= senderLimit then reached = 1 end
if campaignCount + 1 >= campaignLimit then reached = 1; limit = campaignLimit end
return {1, boundary, reached, limit, hour}
`;

export async function reserveSend(connection: Redis, input: {
  senderId: string; campaignId: string; senderLimit: number; campaignLimit: number;
  minDelayMs: number; delayMs: number;
}) {
  const result = await connection.eval(RATE_SCRIPT, 4,
    'rates:sender:' + input.senderId, 'rates:campaign:' + input.campaignId,
    'rates:global-gap', 'rates:sender-gap:' + input.senderId,
    input.senderLimit, input.campaignLimit, input.minDelayMs, Math.max(input.delayMs, input.minDelayMs)) as number[];
  return { allowed: result[0] === 1, retryAt: result[1], reached: result[2] === 1, limit: result[3], hour: result[4] };
}
