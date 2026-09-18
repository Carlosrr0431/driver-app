import { mergeVoiceMessage, mergeVoiceMessages } from '../../src/lib/voiceMessages';

describe('mergeVoiceMessage', () => {
  it('agrega un mensaje nuevo ordenado por fecha', () => {
    const prev = [{ id: 'a', created_at: '2026-01-01T10:00:00.000Z' }];
    const next = mergeVoiceMessage(prev, {
      id: 'b',
      created_at: '2026-01-01T09:00:00.000Z',
    });

    expect(next.map((item) => item.id)).toEqual(['b', 'a']);
  });

  it('actualiza un mensaje existente sin duplicarlo', () => {
    const prev = [{ id: 'a', audio_url: 'old', created_at: '2026-01-01T10:00:00.000Z' }];
    const next = mergeVoiceMessage(prev, {
      id: 'a',
      audio_url: 'new',
      created_at: '2026-01-01T10:00:00.000Z',
    });

    expect(next).toHaveLength(1);
    expect(next[0].audio_url).toBe('new');
  });
});

describe('mergeVoiceMessages', () => {
  it('mezcla varios mensajes sin duplicar', () => {
    const merged = mergeVoiceMessages(
      [{ id: 'a', sender_type: 'base', created_at: '2026-01-01T10:00:00.000Z' }],
      [
        { id: 'b', sender_type: 'driver', created_at: '2026-01-01T10:01:00.000Z' },
        { id: 'a', sender_type: 'base', created_at: '2026-01-01T10:00:00.000Z' },
      ]
    );

    expect(merged.map((item) => item.id)).toEqual(['a', 'b']);
  });
});
