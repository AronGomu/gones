import '@angular/compiler';
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TextPromptDialogComponent } from './dialogs';

const source = readFileSync(join(__dirname, 'dialogs.ts'), 'utf-8');

function confirmButtonMarkup(src: string): string {
  const marker = src.indexOf('data-cy="text-prompt-dialog-confirm"');
  const start = src.lastIndexOf('<button', marker);
  const end = src.indexOf('</button>', marker);
  return src.slice(start, end);
}

describe('TextPromptDialogComponent source', () => {
  it('the prompt dialog submits on Enter', () => {
    expect(source).toContain('data-cy="text-prompt-dialog-form"');
    expect(source).toContain('(ngSubmit)="close()"');
  });

  it('the confirm button submits the form instead of handling its own click', () => {
    const markup = confirmButtonMarkup(source);
    expect(markup).toContain('type="submit"');
    expect(markup).not.toContain('(click)="close()"');
  });

  it('the input keeps initial focus', () => {
    const inputStart = source.indexOf('data-cy="text-prompt-dialog-input"');
    const inputEnd = source.indexOf('>', inputStart);
    const markup = source.slice(inputStart, inputEnd);
    expect(markup).toContain('cdkFocusInitial');
  });

  it('an empty value never closes the dialog', () => {
    expect(source).toContain('if (!value) return;');

    const spy = vi.fn();
    const stub = { value: '   ', ref: { close: spy } };
    TextPromptDialogComponent.prototype.close.call(stub);
    expect(spy).not.toHaveBeenCalled();

    const stub2 = { value: ' Ligue 8 ', ref: { close: spy } };
    TextPromptDialogComponent.prototype.close.call(stub2);
    expect(spy).toHaveBeenCalledWith('Ligue 8');
  });
});
