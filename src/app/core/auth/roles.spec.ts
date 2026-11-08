import { atLeast } from './roles';

describe('atLeast', () => {
  it('ranks L1 < L2 < SUPER', () => {
    expect(atLeast('ADMIN_L1', 'ADMIN_L2')).toBeFalse();
    expect(atLeast('ADMIN_L2', 'ADMIN_L2')).toBeTrue();
    expect(atLeast('ADMIN_SUPER', 'ADMIN_L2')).toBeTrue();
    expect(atLeast('ADMIN_L2', 'ADMIN_SUPER')).toBeFalse();
  });
  it('an unknown or missing role reaches nothing gated', () => {
    expect(atLeast(null, 'ADMIN_L1')).toBeFalse();
    expect(atLeast('CUSTOMER', 'ADMIN_L1')).toBeFalse();
  });
});
