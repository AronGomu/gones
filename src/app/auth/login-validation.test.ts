import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isValidLoginEmail, isValidLoginPassword, loginFormIsValid } from './login-validation';

const componentSource = readFileSync(join(__dirname, 'auth-entry.component.ts'), 'utf8');
const stylesheet = readFileSync(join(__dirname, '..', '..', 'styles.css'), 'utf8');

function loginSubmitLine(): string {
  const formStart = componentSource.indexOf('data-cy="login-form"');
  const formEnd = componentSource.indexOf('</form>', formStart);
  const line = componentSource.slice(formStart, formEnd).split('\n').find((candidate) => candidate.includes('data-cy="auth-submit"'));
  if (!line) throw new Error('no submit button found inside the login form');
  return line;
}

describe('isValidLoginEmail', () => {
  it('accepts a plain address', () => {
    expect(isValidLoginEmail('admin@gones.test')).toBe(true);
  });

  it('accepts a subdomain and a plus tag', () => {
    expect(isValidLoginEmail('a.b+tag@mail.example.co.uk')).toBe(true);
  });

  it('trims before judging', () => {
    expect(isValidLoginEmail('  admin@gones.test  ')).toBe(true);
  });

  it('rejects an empty address', () => {
    expect(isValidLoginEmail('')).toBe(false);
  });

  it('rejects a missing @', () => {
    expect(isValidLoginEmail('admin.gones.test')).toBe(false);
  });

  it('rejects a missing domain dot', () => {
    expect(isValidLoginEmail('admin@localhost')).toBe(false);
  });

  it('rejects whitespace inside', () => {
    expect(isValidLoginEmail('ad min@gones.test')).toBe(false);
  });

  it('rejects a trailing dot', () => {
    expect(isValidLoginEmail('admin@gones.')).toBe(false);
  });
});

describe('isValidLoginPassword', () => {
  it('accepts exactly three characters', () => {
    expect(isValidLoginPassword('abc')).toBe(true);
  });

  it('rejects two characters', () => {
    expect(isValidLoginPassword('ab')).toBe(false);
  });

  it('rejects three spaces', () => {
    expect(isValidLoginPassword('   ')).toBe(false);
  });

  it('rejects an empty password', () => {
    expect(isValidLoginPassword('')).toBe(false);
  });
});

describe('loginFormIsValid', () => {
  it('the form is valid only when both are', () => {
    expect(loginFormIsValid('admin@gones.test', 'abc')).toBe(true);
    expect(loginFormIsValid('nope', 'abc')).toBe(false);
    expect(loginFormIsValid('admin@gones.test', 'ab')).toBe(false);
  });
});

describe('the login submit gate', () => {
  it('the submit button is bound to the validity', () => {
    expect(loginSubmitLine()).toContain('[disabled]="!loginValid()"');
  });

  it('the submit button turns green only when valid', () => {
    expect(loginSubmitLine()).toContain('[class.auth-submit--ready]="loginValid()"');
  });

  it('the ready class is filled green', () => {
    const blockStart = stylesheet.indexOf('.auth-submit--ready {');
    expect(blockStart).toBeGreaterThan(-1);
    const block = stylesheet.slice(blockStart, stylesheet.indexOf('}', blockStart));
    expect(block).toContain('--create-green');
  });

  it('a disabled submit reads as grey', () => {
    const blockStart = stylesheet.indexOf('.auth-submit--idle');
    expect(blockStart).toBeGreaterThan(-1);
    const block = stylesheet.slice(blockStart, stylesheet.indexOf('}', blockStart));
    expect(block).toContain('--steel');
    expect(block).toContain('--dim-ash');
  });

  it('the email field can report its own invalidity', () => {
    expect(componentSource).toContain('data-cy="login-email-validity"');
  });

  it('the password field can report its own invalidity', () => {
    expect(componentSource).toContain('data-cy="login-password-validity"');
  });
});
