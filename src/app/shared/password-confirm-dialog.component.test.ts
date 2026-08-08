import '@angular/compiler';
import { describe, expect, it, vi } from 'vitest';
import { Injector, runInInjectionContext } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { PasswordConfirmDialogComponent, PasswordConfirmDialogData } from './password-confirm-dialog.component';

const data: PasswordConfirmDialogData = {
  title: 'Delete your account?',
  message: 'This permanently deletes your account.',
  confirmLabel: 'Delete account',
  passwordLabel: 'Current password'
};

function createComponent() {
  const ref = { close: vi.fn() };
  const injector = Injector.create({
    providers: [
      { provide: MAT_DIALOG_DATA, useValue: data },
      { provide: MatDialogRef, useValue: ref }
    ]
  });
  const component = runInInjectionContext(injector, () => new PasswordConfirmDialogComponent());
  return { component, ref };
}

describe('PasswordConfirmDialogComponent', () => {
  it('confirm is disabled without a password', () => {
    const { component, ref } = createComponent();
    component.password = '';
    component.confirm();
    expect(ref.close).not.toHaveBeenCalled();
  });

  it('confirm returns the typed password', () => {
    const { component, ref } = createComponent();
    component.password = 'hunter2';
    component.confirm();
    expect(ref.close).toHaveBeenCalledWith('hunter2');
  });

  it('cancel returns undefined', () => {
    const { component, ref } = createComponent();
    component.cancel();
    expect(ref.close).toHaveBeenCalledWith(undefined);
  });
});
