import { once } from './once';

describe('once', () => {
  it('runs the factory once and memoizes the result', () => {
    const factory = jest.fn(() => ({ id: 1 }));
    const get = once(factory);
    const a = get();
    const b = get();
    expect(factory).toHaveBeenCalledTimes(1);
    expect(a).toBe(b); // same instance across calls (singleton)
  });

  it('is lazy — nothing runs until first resolved', () => {
    const factory = jest.fn(() => 42);
    const get = once(factory);
    expect(factory).not.toHaveBeenCalled();
    expect(get()).toBe(42);
  });

  it('memoizes falsy results (only runs once even when value is undefined)', () => {
    const factory = jest.fn(() => undefined);
    const get = once(factory);
    get();
    get();
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('supports order-independent wiring (a factory may resolve another)', () => {
    const base = once(() => ({ n: 7 }));
    const derived = once(() => ({ doubled: base().n * 2 }));
    expect(derived().doubled).toBe(14);
    expect(base()).toBe(base());
  });
});
