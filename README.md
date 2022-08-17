# tinyserve

* a small local dev server that supports live reloading via [server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events)
* only one dependency, `[mime-db](https://www.npmjs.com/package/mime-db)`
* absolutely not for use in production

## installation

`npm install @potch/tinyserve` or `npx tinyserve` if you're feeling frisky

## usage

`> tinyserve [options]`

### options
```
  -h, --help     this help text
  -d             directory to serve, default is "."
  -p             port, default is 8080
  -w <path>      watch file or folder for changes- setting this enables live reload
  -l <route>     URL path of live reload events, default is "_live"
```
