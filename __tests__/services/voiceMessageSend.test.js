jest.mock('../../src/services/supabase', () => ({
  supabase: { auth: { refreshSession: jest.fn() } },
}));
jest.mock('../../src/services/authSession', () => ({
  getSafeSession: jest.fn(),
}));

import { insertDriverVoiceViaDashboard } from '../../src/services/voiceMessageSend';

describe('insertDriverVoiceViaDashboard', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('devuelve el audio guardado por la API de la base', async () => {
    const message = {
      id: 'msg-1',
      driver_id: 'drv-1',
      sender_type: 'driver',
      audio_url: 'https://cdn.example/a.m4a',
    };
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, message }),
    });

    const saved = await insertDriverVoiceViaDashboard({
      audioUrl: message.audio_url,
      durationSeconds: 4,
      dashboardUrl: 'https://www.profesionalviajes.com.ar',
      accessToken: 'token',
    });

    expect(saved).toEqual(message);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://www.profesionalviajes.com.ar/api/driver/voice-messages',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
