import { spawn } from "node:child_process";

export type WorkerOutput =
  | { ok: true; result: Record<string, unknown>; artifacts?: unknown }
  | { ok: false; error: string };

const MAX_STDOUT_BYTES = 64 * 1024 * 1024;

/**
 * Runs `python -m datapilot.worker` with a JSON job on stdin. Python gets a
 * minimal environment: no database URL, no storage key, no API secrets.
 */
export function runPythonWorker(
  options: { python: string; pythonPath: string; cwd: string; timeoutMs: number },
  job: Record<string, unknown>,
): Promise<WorkerOutput> {
  return new Promise((resolve, reject) => {
    // -I (isolated mode) ignores PYTHONPATH and the working directory, so the
    // engine's source directory is added explicitly.
    const bootstrap =
      "import sys, runpy; sys.path.insert(0, sys.argv[1]); runpy.run_module('datapilot.worker', run_name='__main__')";
    const child = spawn(options.python, ["-I", "-c", bootstrap, options.pythonPath], {
      cwd: options.cwd,
      env: {
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        MPLBACKEND: "Agg",
        MPLCONFIGDIR: options.cwd,
        HOME: options.cwd,
        PYTHONHASHSEED: "0",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    let stdoutBytes = 0;
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Processing timed out."));
    }, options.timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_STDOUT_BYTES) child.kill("SIGKILL");
      else stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < 8000) stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`Worker exited with code ${code}: ${stderr.slice(-2000)}`));
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(stdout).toString("utf8")) as WorkerOutput);
      } catch {
        reject(new Error(`Worker returned invalid output: ${stderr.slice(-2000)}`));
      }
    });
    child.stdin.end(JSON.stringify(job));
  });
}
