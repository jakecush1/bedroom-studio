// tfjs's WebGL backend touches `window` in places; in a worker `self` is the
// global. Imported first so it runs before tfjs is evaluated.
if (typeof window === "undefined" && typeof self !== "undefined") self.window = self;
