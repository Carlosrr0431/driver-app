const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '../../src/components/VoiceChatModal.jsx');

describe('VoiceChatModal layout', () => {
  it('usa Modal a pantalla completa y muestra el botón de grabar fuera de las tabs', () => {
    const src = fs.readFileSync(SRC, 'utf8');

    expect(src).toMatch(/<Modal/);
    expect(src).toMatch(/presentationStyle="fullScreen"/);
    expect(src).toMatch(/Presioná para grabar mensaje/);
    expect(src).not.toMatch(/androidOverlay/);
  });
});
