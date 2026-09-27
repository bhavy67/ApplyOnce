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

describe('custom control metadata in messages', () => {
  const combobox = {
    id: 'id:mode',
    type: 'select',
    htmlType: 'combobox',
    required: false,
    visible: true,
    disabled: false,
    custom: { pattern: 'combobox', supported: true },
    signals: { label: 'Work mode' },
  };

  it('accepts a custom select field', () => {
    expect(parseMessage({ type: MessageType.MapFields, payload: { fields: [combobox] } }).ok).toBe(
      true,
    );
  });

  it.each([
    { pattern: 'mui-select', supported: true },
    { pattern: 'combobox', supported: 'yes' },
    'combobox',
  ])('rejects malformed custom metadata %j', (custom) => {
    expect(
      parseMessage({ type: MessageType.MapFields, payload: { fields: [{ ...combobox, custom }] } }),
    ).toEqual({ ok: false, error: 'malformed-message' });
  });
});

describe('Phase 8 metadata in messages', () => {
  const base = {
    id: 'key:school',
    type: 'text',
    htmlType: 'text',
    required: false,
    visible: true,
    disabled: false,
    signals: { label: 'University' },
  };

  it('accepts search-input and repeated-question metadata', () => {
    const fields = [
      { ...base, custom: { pattern: 'search-input', supported: false } },
      { ...base, id: 'key:t', repeatedCount: 2 },
    ];
    expect(parseMessage({ type: MessageType.MapFields, payload: { fields } }).ok).toBe(true);
  });

  it.each([0, -1, 1.5, '2'])('rejects repeatedCount %j', (repeatedCount) => {
    expect(
      parseMessage({
        type: MessageType.MapFields,
        payload: { fields: [{ ...base, repeatedCount }] },
      }),
    ).toEqual({ ok: false, error: 'malformed-message' });
  });
});
