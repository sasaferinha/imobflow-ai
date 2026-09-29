// In-memory boundary for existing worker regressions. The SQL turn/concurrency
// contract is tested separately; these fixtures exercise the actual worker and
// keep profile changes, handoff and the reply in one mocked enqueue operation.
const assert = require('node:assert/strict');

function singleMessageTurns({ canClaim = () => true, enqueue }) {
  let sequence = 0;
  const finished = new Set();
  const handoffs = new Set();
  const active = new Map();
  const identity = input => [input.companyId, input.conversationId, input.incomingExternalMessageId].join(':');
  return {
    ATTENDANCE_DEBOUNCE_MS: 3000,
    async claimAttendanceTurn(input) {
      const event = identity(input);
      if (finished.has(event) || !await canClaim(input)) return { status: 'ignored' };
      if (active.has(event)) return { status: 'deferred', retryAfterMs: 3000 };
      const turn = {
        status: 'claimed', token: `fixture-token-${++sequence}`, key: `fixture-turn-${sequence}`,
        watermark: sequence, latestOccurredAt: input.occurredAt, overflow: false,
        messages: [{ externalMessageId: input.incomingExternalMessageId, message: input.message,
          hasImage: input.hasImage, hasAudio: input.hasAudio, occurredAt: input.occurredAt }],
      };
      active.set(event, turn);
      return turn;
    },
    async enqueueAttendanceTurn(input, turn, content, options) {
      assert.equal(active.get(identity(input)), turn, 'enqueue uses the claimed turn');
      assert.equal(typeof content, 'string');
      assert.ok(content.trim(), 'never queue an empty reply');
      assert.equal(typeof options.handoff, 'boolean');
      assert.equal(typeof options.profileVersion, 'string', 'atomic save includes the read profile version');
      assert.ok(options.profilePatch && typeof options.profilePatch === 'object');
      const result = await enqueue(input, content, options, turn);
      if (result.status === 'queued' && options.handoff) handoffs.add(`${input.companyId}:${input.conversationId}`);
      if (result.status !== 'superseded') finished.add(identity(input));
      return result;
    },
    async reconcileAttendanceHandoffs(input) {
      assert.ok(handoffs.has(`${input.companyId}:${input.conversationId}`), 'only a queued handoff is reconciled by the worker');
      return 0;
    },
    async releaseAttendanceTurn(input, turn) {
      assert.equal(active.get(identity(input)), turn, 'only the owning turn can release its reservation');
      active.delete(identity(input));
    },
  };
}

module.exports = { singleMessageTurns };
