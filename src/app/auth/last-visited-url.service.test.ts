import { describe, expect, it } from 'vitest';
import { LastVisitedUrlService } from './last-visited-url.service';

describe('LastVisitedUrlService', () => {
  it('records a non-auth url', () => {
    const service = new LastVisitedUrlService();
    service.record('/events?view=list');
    expect(service.last()).toBe('/events?view=list');
  });

  it('ignores auth urls', () => {
    const service = new LastVisitedUrlService();
    service.record('/events');
    service.record('/login?returnUrl=%2Fevents');
    expect(service.last()).toBe('/events');
  });

  it('ignores every auth path', () => {
    const service = new LastVisitedUrlService();
    service.record('/register');
    service.record('/verify-email');
    service.record('/forgot-password');
    service.record('/reset-password');
    service.record('/auth/complete-profile');
    expect(service.last()).toBe('');
  });
});
