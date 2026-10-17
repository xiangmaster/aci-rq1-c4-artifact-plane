# config-audit

`config-audit` validates JSON configuration files against a small declarative
schema. It reports required fields, type mismatches, enum violations, pattern
violations, and unknown keys.

## Use

```bash
config-audit config.json schema.json
```

```js
import { audit } from "config-audit";

const result = audit(config, { region: { required: true, type: "string" } });
```

## Development

```bash
npm ci
npm run check
```
