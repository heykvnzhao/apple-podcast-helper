function printToStdout(content) {
  return new Promise((resolve, reject) => {
    const handleError = (error) => {
      process.stdout.off("error", handleError);
      if (error && error.code === "EPIPE") {
        resolve();
        return;
      }
      reject(error);
    };
    process.stdout.on("error", handleError);
    const finalize = () => {
      process.stdout.off("error", handleError);
      resolve();
    };
    const canContinue = process.stdout.write(content, finalize);
    if (!canContinue) {
      process.stdout.once("drain", finalize);
    }
  });
}

export { printToStdout };
