# SkySecure Agent Factory

> Engineering dependable AI agents and reusable foundations.

SkySecure Agent Factory is the engineering home for reusable AI-agent capabilities, supporting services, interfaces, and shared foundations. We turn well-defined ideas into dependable systems through disciplined delivery, thoughtful design, and secure engineering practices.

## What we build

- AI-agent backends, APIs, and orchestration services
- Focused user experiences and integration surfaces
- Shared components, libraries, and platform foundations
- Delivery automation that supports reliable operation

## Repository conventions

| Repository type | Naming convention |
|---|---|
| Backend services and APIs | `af-be-*` |
| Frontend applications and experiences | `af-fe-*` |
| Common services and shared foundations | `af-cmn-*` |
| Standalone agent capabilities | `af-<capability>-agent` |

## Delivery lifecycle

```text
Design -> Build -> Validate -> Review -> Release -> Operate
```

Changes are developed and verified in `dev`. Promotion to `prod` happens through a reviewed pull request after the required quality, security, and approval checks pass.

## Engineering principles

- Security and privacy by design
- Least-privilege access and responsible secret management
- Clear ownership, useful documentation, and maintainable code
- Automated testing and evidence-based delivery
- Observable and resilient production services
- Reusable foundations with well-defined boundaries
- No customer data, credentials, or sensitive infrastructure details in source code

## Working with us

Authorized SkySecure team members should review the target repository guidance, create a focused working branch, validate the change, and submit a pull request with clear context, test evidence, configuration impact, and rollback considerations.

Repository access and operational details are limited according to business need and company security policies. For access or support, use the approved internal channel and contact the relevant repository owner.

---

Built with care by the **SkySecure Agent Factory**.
