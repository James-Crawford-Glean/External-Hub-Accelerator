// The whole DI "framework": lazy + memoized. Wrap each service/resolver factory in
// once() and wiring becomes order-independent (nothing runs until first resolved),
// singletons are reused across warm Lambda invokes (same as the old appPromise ??=),
// and each entrypoint builds only what it touches (stream never constructs the 34
// api services). Replaces NestFactory + @Injectable/@Module/reflect-metadata.
export const once = <T>(f: () => T): (() => T) => {
  let value: T;
  let done = false;
  return () => (done ? value : ((done = true), (value = f())));
};
