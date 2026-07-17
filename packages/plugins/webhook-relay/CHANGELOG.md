# @nexpress/plugin-webhook-relay

## 0.4.1

### Patch Changes

- @nexpress/plugin-sdk@0.4.1

## 0.4.0

### Patch Changes

- 75e6c34: Give every content, auth, media, and render hook one exact typed data contract.
  Normalize content lifecycle payloads around document state, source, and
  principal; normalize media upload results; reject malformed dispatch data and
  unknown hook names at the core boundary; and diagnose values returned from
  fire-and-forget lifecycle handlers.
- e0a2092: Add typed definition-level plugin actions, validate declarative Admin action
  ids and result kinds early, and surface missing, mismatched, duplicate,
  setup-untyped, and Admin-unreferenced actions through plugin doctor.
- Updated dependencies [7d31c88]
- Updated dependencies [c10eb69]
- Updated dependencies [3396b1c]
- Updated dependencies [3d45e43]
- Updated dependencies [75e6c34]
- Updated dependencies [e0a2092]
- Updated dependencies [8cb026a]
- Updated dependencies [81b3fb5]
- Updated dependencies [f6fa9d1]
- Updated dependencies [5522c32]
- Updated dependencies [0944d13]
- Updated dependencies [ccad4ed]
  - @nexpress/plugin-sdk@0.4.0

## 0.2.18

### Patch Changes

- Updated dependencies [61d3c2e]
  - @nexpress/plugin-sdk@0.3.26

## 0.2.17

### Patch Changes

- @nexpress/plugin-sdk@0.3.25

## 0.2.16

### Patch Changes

- @nexpress/plugin-sdk@0.3.24

## 0.2.15

### Patch Changes

- @nexpress/plugin-sdk@0.3.23

## 0.2.14

### Patch Changes

- @nexpress/plugin-sdk@0.3.22

## 0.2.13

### Patch Changes

- @nexpress/plugin-sdk@0.3.21

## 0.2.12

### Patch Changes

- Updated dependencies [769473f]
  - @nexpress/plugin-sdk@0.3.20

## 0.2.11

### Patch Changes

- @nexpress/plugin-sdk@0.3.19

## 0.2.10

### Patch Changes

- @nexpress/plugin-sdk@0.3.18

## 0.2.9

### Patch Changes

- @nexpress/plugin-sdk@0.3.17

## 0.2.8

### Patch Changes

- @nexpress/plugin-sdk@0.3.16

## 0.2.7

### Patch Changes

- @nexpress/plugin-sdk@0.3.15

## 0.2.6

### Patch Changes

- @nexpress/plugin-sdk@0.3.14

## 0.2.5

### Patch Changes

- @nexpress/plugin-sdk@0.3.13

## 0.2.4

### Patch Changes

- @nexpress/plugin-sdk@0.3.12

## 0.2.3

### Patch Changes

- @nexpress/plugin-sdk@0.3.11

## 0.2.2

### Patch Changes

- @nexpress/plugin-sdk@0.3.10

## 0.2.1

### Patch Changes

- @nexpress/plugin-sdk@0.3.9

## 0.2.0

### Minor Changes

- b331118: Add bundled analytics-lite and webhook-relay plugin examples, and derive admin,
  page-route, and scheduled-task capabilities from `definePlugin()` declarations.
  Also derive page-route and scheduled-task catalog metadata and add typed admin
  action result helpers. Add plugin storage append/listValues helpers for
  event-log style plugin data. Add typed admin action registration helpers and
  pass the runtime context into action handlers. Update plugin scaffolds/tests
  around the newer authoring surface and document the `allowedHosts: ["*"]`
  escape hatch for operator-configured integration endpoints.

### Patch Changes

- Updated dependencies [b331118]
  - @nexpress/plugin-sdk@0.3.8
