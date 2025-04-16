# tinyserve

- a small local dev server that supports live reloading via [server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events)
- only one dependency, [`mime-db`](https://www.npmjs.com/package/mime-db)
- absolutely not for use in production

## installation

`npm install @potch/tinyserve` or `npx tinyserve` if you're feeling frisky

## usage

`> tinyserve [options]`

`> tinyserve -p 1234 -d dist/ -w dist/`

### options

```
  -h, --help     this help text
  -d <dir>       directory to serve, default is "."
  -p <port>      port, default is 8080
  -w <path>      watch file or folder for changes, implies -l
  -x <command>   run this command on changes, needs -w
  -l             enable live reload
  -r <route>     URL path of live reload events, default is "_live
  -v             enable verbose logging"
```

### live reload

when live reload is enabled, a small script is injected into all HTML responses that listens for a reload signal from the server. that signal can be triggered by either a change to a watched file/directory (via the `-w` option), or local tools can trigger a reload by making a `post` to the live reload route (by default `/_live`).
