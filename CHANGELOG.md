# Changelog

## 1.3.1

- Fix an issue where the browser would fail to start.

## 1.3.0

- Refactor the codebase to TypeScript and render in-memory when `EAGER_RERENDER` is set.

## 1.2.0

- When `EAGER_RERENDER` is set, don't do the initial render or enable the cronjob.

## 1.1.3

- Stop logging the env during boot.

## 1.1.2

- Fix inclusion of `INCLUDE_CACHE_BREAK_QUERY` and `EAGER_RERENDER` options in the env

## 1.1.1

- Fix an issue with reading the `INCLUDE_CACHE_BREAK_QUERY` environment variable
- Log the configuration at boot

## 1.1.0

- Add an option to eagerly rerender pages on request
- Add an option to always perform an uncached rerender

## 1.0.0

Initial release
