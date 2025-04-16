#! /usr/bin/env node

import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import { spawn } from "child_process";
import mimeDB from "mime-db";

const quotedStringRE = /\s+(?=(?:[^\'"]*[\'"][^\'"]*[\'"])*[^\'"]*$)/;

// arg parsing
const hasArg = (arg) => process.argv.includes(arg);
const getArg = (arg, def) => {
  const pos = process.argv.indexOf(arg);
  if (pos > -1) {
    return process.argv[pos + 1];
  }
  return def;
};

// event bus
const createBus = () => {
  const listeners = new Set();
  return {
    emit: (o) => listeners.forEach((l) => l(o)),
    on: (l) => listeners.add(l),
    off: (l) => listeners.delete(l),
  };
};

// read args
const port = process.env.PORT || getArg("-p") || 8080;
const isLive = hasArg("-l") || hasArg("-w");
const livePath = getArg("-r", "_live");
const dir = getArg("-d", ".");
const watch = getArg("-w", "");
const command = getArg("-x", "");
const verbose = hasArg("-v");

if (hasArg("--help") || hasArg("-h")) {
  console.log(`tinyserve - tiny file server

options:
  -h, --help     this help text
  -d <dir>       directory to serve, default is "."
  -p <port>      port, default is 8080
  -w <path>      watch file or folder for changes, implies -l
  -x <command>   run this command on changes, needs -w
  -l             enable live reload
  -r <route>     URL path of live reload events, default is "_live"
  `);
  process.exit(0);
}

const baseDir = path.join(process.cwd(), dir);

async function sendFile(response, path) {
  if (isLive && path.endsWith(".html")) {
    // inject the watchScript
    let file = await fs.promises.readFile(path);
    let content = file.toString("utf8");
    return response.end(content.replace("</body>", watchScript + "</body>"));
  }
  // send file normally
  const stream = fs.createReadStream(path);
  stream.pipe(response);
}

const exists = async (path) => {
  try {
    await fs.promises.access(path, fs.constants.R_OK);
    return true;
  } catch (e) {
    console.warn(e);
    return false;
  }
};

const mimeTypes = Object.entries(mimeDB).reduce((o, [type, data]) => {
  if (data.extensions) {
    data.extensions.forEach((extension) => (o[extension] = type));
  }
  return o;
}, {});

const mimeType = (filePath, trim) => {
  let ext = path.extname(path.basename(filePath, trim));
  if (ext) {
    ext = ext.substring(1);
    if (ext in mimeTypes) {
      return mimeTypes[ext];
    }
  }
  return "text/plain";
};

// watcher stuff
const changeBus = createBus();

// injected into pages
const watchScript = `
<script>
  function connect() {
    const source = new EventSource("/${livePath}");
    source.addEventListener('message', e => {
      const data = JSON.parse(e.data);
      if (data.reload) {
        window.location.reload();
      }
    });
  }
  connect();
</script>
`;

const runCommand = (command) =>
  new Promise((done) => {
    const [cmd, ...args] = command.split(quotedStringRE);
    console.log(">", command);
    const proc = spawn(cmd, args, { stdio: "inherit" });
    proc.on("stdout", (data) => process.stdout.write(data));
    proc.on("stderr", (err) => process.stdout.write(err));
    proc.on("exit", () => done());
  });

// does the watching
const mtimes = new Map();
async function startWatcher(path) {
  const ac = new AbortController();
  const { signal } = ac;
  try {
    const watcher = fs.promises.watch(path, { signal });
    for await (const { eventType, filename } of watcher) {
      verbose && console.error(eventType, filename);
      // debounce multiple events for the same change
      if (filename) {
        try {
          const mtime = (await fs.promises.stat(filename))?.mtimeMs;
          const lastMtime = mtimes.get(filename);
          if (mtime) {
            verbose && console.error("setting modified time for", path, mtime);
            mtimes.set(filename, mtime);
            if (mtime === lastMtime) {
              verbose && console.error("ignoring duplicate change for", path);
              continue;
            }
          }
        } catch (e) {
          verbose && console.error(e);
        }
      }
      console.log("[live] changes detected", filename);
      if (command) {
        await runCommand(command);
      }
      changeBus.emit();
    }
  } catch (err) {
    console.log("[live] closing watcher");
    verbose && console.error(err);
    if (err.name === "AbortError") return;
    ac.abort();
  }
}

// live reload powered by Server-Sent Events
async function liveReload(request, response) {
  console.log("[live] client connected");

  const sendReload = () => {
    response.write(`data: {"reload":true}\n\n`);
  };

  request.on("close", (e) => {
    console.log("[live] client disconnected");
    changeBus.off(sendReload);
  });

  changeBus.on(sendReload);
}

// server stuff
const server = http.createServer(async (request, response) => {
  console.log(request.method, request.url);

  if (request.method.toLowerCase() === "post") {
    if (isLive && request.url === "/" + livePath) {
      changeBus.emit();
      response.statusCode = 204;
      return response.end();
    }
  }

  if (request.method.toLowerCase() !== "get") {
    response.statusCode = 400;
    response.end("Bad Request");
  }

  const url = new URL(request.url, `http://${request.headers.host}`);
  const filePath = path.join(baseDir, url.pathname);

  // handle live reload requests
  if (isLive && request.url === "/" + livePath) {
    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Access-Control-Allow-Origin": "*",
    });
    response.write("retry: 5000\n\n");
    return liveReload(request, response);
  }

  // handle bare folder requests
  if (filePath.endsWith("/")) {
    let maybeIndexFile = path.join(filePath, "index.html");
    if (await exists(maybeIndexFile)) {
      response.setHeader("Content-Type", mimeTypes.html);
      return sendFile(response, maybeIndexFile);
    } else {
      try {
        let files = await fs.promises.readdir(filePath, {
          withFileTypes: true,
        });
        return response.end(`
          <head>
            <meta charset="utf8">
            <style>
              div {
                margin: 0 auto;
                max-width: 480px;
              }
              a {
                display: block;
                padding: .25rem;
              }
              a + a {
                border--top: 1px solid #ccc;
              }
              a:hover {
                background: #eee;
              }
            </style>
          </head>
          <div>
            ${files
              .map((file) => {
                if (file.isDirectory()) {
                  return `<a href="${url.href}${file.name}/">📁 ${file.name}</a>`;
                }
                return `<a href="${url.href}${file.name}">📄 ${file.name}</a>`;
              })
              .join("\n")}
          </div>
        `);
      } catch (e) {
        console.warn(e);
      }
    }
  }

  // send the file if it exists
  try {
    if (await exists(filePath)) {
      let ext = path.extname(filePath);
      if (ext === ".gz") {
        response.setHeader("Content-Encoding", "gzip");
        if (mimeType(filePath, ".gz")) {
          response.setHeader("Content-Type", mimeType(filePath, ".gz"));
        }
      } else {
        if (mimeType(filePath)) {
          response.setHeader("Content-Type", mimeType(filePath));
        }
      }
      return sendFile(response, filePath);
    }
  } catch (e) {
    console.error(e);
  }

  response.statusCode = 404;
  response.end("File Not Found");
});

// start up the server
server.listen(port, () => {
  console.log(`Server running at port ${port}`);
  if (isLive) {
    const watchPaths = watch.split(quotedStringRE);
    for (const p of watchPaths) {
      const watchPath = path.join(process.cwd(), p);
      verbose && console.error("watching path:", watchPath);
      startWatcher(watchPath);
    }
    console.log(`watching for changes in ${watch}`);
    console.log(`listening for live-reload clients at /${livePath}`);
  }
});
