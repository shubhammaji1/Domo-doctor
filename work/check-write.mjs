const original = process.stdout.write.bind(process.stdout);
process.stdout.write = (chunk) => {
  process.stderr.write(`captured:${chunk}`);
  return true;
};
process.stdout.write = original;
process.stdout.write("restored\n");
