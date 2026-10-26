// Builds the JC-808 on its own page (standalone/jc808) into dist-jc808/,
// which update.sh publishes to the jc-808 repo.
export default {
  root: "standalone/jc808",
  base: "./",
  publicDir: false,
  build: { outDir: "../../dist-jc808", emptyOutDir: true },
  worker: { format: "es" }
};
