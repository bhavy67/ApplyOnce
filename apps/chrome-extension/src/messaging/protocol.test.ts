import { describe, expect, it } from 'vitest';
import { createMessage, isFillResultList, MessageType, parseMessage } from './protocol';

const instruction = {
  fieldId: 'id:email',
  value: 'jane.doe@example.com',
  expected: { type: 'email', name: 'email' },
};

describe('parseMessage', () => {
  it('accepts a well-formed FillFields message', () => {
    const message = { type: MessageType.FillFields, payload: { instructions: [instruction] } };
    expect(parseMessage(message)).toEqual({ ok: true, data: message });
  });

  it.each([
    { instructions: [{ ...instruction, value: { nested: 'object' } }] },
    { instructions: [{ ...instruction, expected: { type: 'password' } }] },
    { instructions: [{ value: 'x', expected: { type: 'text' } }] },
    { instructions: 'all' },
    undefined,
  ])('rejects malformed FillFields payload %j', (payload) => {
    expect(parseMessage({ type: MessageType.FillFields, payload })).toEqual({
      ok: false,
      error: 'malformed-message',
    });
  });

  it('builds messages with and without payloads', () => {
    expect(createMessage(MessageType.Ping)).toEqual({ type: MessageType.Ping });
    expect(createMessage(MessageType.FillFields, { instructions: [] })).toEqual({
      type: MessageType.FillFields,
      payload: { instructions: [] },
    });
  });
});

describe('isFillResultList', () => {
  it('validates fill results from the page', () => {
    expect(isFillResultList([{ fieldId: 'a', status: 'filled', message: 'Filled.' }])).toBe(true);
    expect(isFillResultList([{ status: 'filled' }])).toBe(false);
    expect(isFillResultList('filled')).toBe(false);
  });
});
