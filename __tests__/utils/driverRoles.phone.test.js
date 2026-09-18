import {
  classifyLoginIdentifier,
  extractLocalArMobileDigits,
  formatLocalArMobileDisplay,
  formatLoginPhoneHint,
  getLoginIdentifierGuidance,
  getLoginPhoneGuidance,
  isCompleteLocalArMobile,
  isCompleteLoginIdentifier,
  normalizeDriverPhone,
  sanitizeLoginPhoneInput,
  splitLocalArMobileParts,
} from '../../src/utils/driverRoles';

describe('login de teléfono AR', () => {
  it('normaliza 10 dígitos locales al canónico 549… de choferes', () => {
    expect(normalizeDriverPhone('3875345465')).toBe('5493875345465');
    expect(normalizeDriverPhone('387 8630173')).toBe('5493878630173');
  });

  it('extrae locales desde +54, 549 y 9', () => {
    expect(extractLocalArMobileDigits('3875345465')).toBe('3875345465');
    expect(extractLocalArMobileDigits('+54 3875 345465')).toBe('3875345465');
    expect(extractLocalArMobileDigits('5493875345465')).toBe('3875345465');
    expect(extractLocalArMobileDigits('93875345465')).toBe('3875345465');
  });

  it('formatea 3875 + 6 dígitos y 387 + 7 dígitos', () => {
    expect(formatLocalArMobileDisplay('3875345465')).toBe('3875 345465');
    expect(formatLocalArMobileDisplay('3871234567')).toBe('387 1234567');
    expect(formatLoginPhoneHint('3875345465')).toBe('+54 3875 345465');
  });

  it('acepta solo un número local completo de 10 dígitos', () => {
    expect(isCompleteLocalArMobile('3875345465')).toBe(true);
    expect(isCompleteLocalArMobile('387534546')).toBe(false);
    expect(isCompleteLocalArMobile('54')).toBe(false);
  });

  it('sanitiza el input: solo dígitos locales, ignora pegado incompleto de +54', () => {
    expect(sanitizeLoginPhoneInput('3875 345465')).toBe('3875345465');
    expect(sanitizeLoginPhoneInput('3875')).toBe('3875');
    expect(sanitizeLoginPhoneInput('5493875')).toBeNull();
    expect(sanitizeLoginPhoneInput('+54 9 3875 345465')).toBe('3875345465');
  });

  it('parte el número en área y local para la guía visual', () => {
    expect(splitLocalArMobileParts('3875345465')).toEqual(expect.objectContaining({
      area: '3875',
      number: '345465',
      areaSize: 4,
      numberSize: 6,
    }));
    expect(splitLocalArMobileParts('3871234567')).toEqual(expect.objectContaining({
      area: '387',
      number: '1234567',
      areaSize: 3,
      numberSize: 7,
    }));
  });

  it('explica cómo cargar el teléfono y qué está mal', () => {
    expect(getLoginPhoneGuidance('').status).toBe('idle');
    expect(getLoginPhoneGuidance('').message).toContain('Sin 0');

    expect(getLoginPhoneGuidance('', { submitted: true })).toEqual(expect.objectContaining({
      status: 'error',
      title: 'Falta el teléfono',
    }));

    expect(getLoginPhoneGuidance('03875').title).toBe('Sacá el 0 del principio');
    expect(getLoginPhoneGuidance('15').title).toBe('No hace falta el 15');
    expect(getLoginPhoneGuidance('93875').title).toBe('No pongas el 9 adelante');
    expect(getLoginPhoneGuidance('3875', { submitted: true }).title).toBe('El número está incompleto');
    expect(getLoginPhoneGuidance('3875', { submitted: true }).message).toContain('3875 345465');

    expect(getLoginPhoneGuidance('3875345465')).toEqual(expect.objectContaining({
      status: 'ok',
      title: 'Número listo',
    }));

    expect(getLoginPhoneGuidance('3875', { blockedCountryPaste: true }).title).toBe('El +54 ya está puesto');
  });
});

describe('login unificado teléfono o correo', () => {
  it('clasifica teléfono, correo y vacío', () => {
    expect(classifyLoginIdentifier('3875345465').kind).toBe('phone');
    expect(classifyLoginIdentifier('juan@gmail.com').kind).toBe('email');
    expect(classifyLoginIdentifier('').kind).toBe('empty');
  });

  it('acepta un identificador completo de teléfono o correo', () => {
    expect(isCompleteLoginIdentifier('3875345465')).toBe(true);
    expect(isCompleteLoginIdentifier('juan@gmail.com')).toBe(true);
    expect(isCompleteLoginIdentifier('juan@profesional.test')).toBe(false);
    expect(isCompleteLoginIdentifier('3875')).toBe(false);
  });

  it('da feedback corto verde o rojo según el input', () => {
    expect(getLoginIdentifierGuidance('').status).toBe('idle');
    expect(getLoginIdentifierGuidance('', { submitted: true })).toEqual(expect.objectContaining({
      status: 'error',
      message: 'Ingresá tu teléfono o correo.',
    }));
    expect(getLoginIdentifierGuidance('3875345465')).toEqual(expect.objectContaining({
      status: 'ok',
      message: 'Número listo.',
    }));
    expect(getLoginIdentifierGuidance('juan@gmail.com')).toEqual(expect.objectContaining({
      status: 'ok',
      message: 'Correo listo.',
    }));
    expect(getLoginIdentifierGuidance('03875').status).toBe('error');
    expect(getLoginIdentifierGuidance('mal@', { submitted: true }).message).toBe('El correo no es válido.');
  });
});
