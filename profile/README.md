<p align="center">
  <img src="https://raw.githubusercontent.com/skysecure-agent-factory/.github/prod/profile/assets/realize-banner.svg" alt="SkySecure Agent Factory — Build for the business. Deliver through Realize." width="100%" />
</p>

<p align="center">
  <strong>Business-first agents. Disciplined engineering. Repeatable deployment.</strong>
</p>

<p align="center">
  <a href="#the-factory">Our mission</a> &nbsp; · &nbsp;
  <a href="#three-implementation-approaches">Approaches</a> &nbsp; · &nbsp;
  <a href="#developer-guide">Developer guide</a> &nbsp; · &nbsp;
  <a href="#engineering-together">Engineering standards</a>
</p>

<br />

## The factory

**Purpose-built AI agents for real business needs, delivered through Realize.**

We turn a focused business use case into a complete, supported workflow: define a measurable outcome, build the agent and its integrations, and validate the end-to-end experience. Realize brings those agents to customers through automated deployment.

<br />

## Three implementation approaches

One business outcome. An implementation that fits the customer's environment.

<table>
  <tr>
    <td width="33%" valign="top">
      <h3>Copilot</h3>
      <p>Agents built around Microsoft Copilot and its supported integrations.</p>
      <p><code>copilot</code></p>
    </td>
    <td width="33%" valign="top">
      <h3>Foundry</h3>
      <p>Agents powered by Microsoft's Azure-hosted AI models and services.</p>
      <p><code>foundry</code></p>
    </td>
    <td width="33%" valign="top">
      <h3>Open source</h3>
      <p>Agents using selected open-source or open-weight models.</p>
      <p><code>opensource</code> · Roadmap</p>
    </td>
  </tr>
</table>

Availability varies by agent. Open-source delivery is planned; model suitability, licensing, security, and hosting must be validated before release.

<br />

## Developer guide

> [!IMPORTANT]
> **Every developer must use the engineering guide when building or releasing an agent.**
>
> [Open the SkySecure AI Agent Engineering and Production Guide →](https://skysecure-agent-factory.github.io/.github/)

1. **Define the scope.** Complete [Step 0: project profile](https://skysecure-agent-factory.github.io/.github/#step-0) and identify the applicable controls.

2. **Build with evidence.** Validate functionality, security, tenant isolation, data integrity, reliability, and recovery.

3. **Check the release.** Complete [Step 23: final release gate](https://skysecure-agent-factory.github.io/.github/#step-23) and resolve applicable blockers.

The guide applies to every agent and approach. Production approval depends on verified results for the actual release and customer environment—not a successful build alone. Keep confidential evidence in approved, access-controlled locations.

<br />

## From idea to production

**Define → Build → Validate → Review → Deploy → Operate**

Each release needs clear ownership, test evidence, customer authorization, correct permissions, and a verified deployment outcome. Use the approved release workflow, monitor the result, and maintain a practical recovery path.

<br />

## Engineering together

Consistent conventions keep collaboration simple as the factory grows.

<br />

### 01 · Repository naming

**A clear name for every agent.**

```text
af-{layer}-{business-name}-agent-{approach}
```

- **Layer:** `be` for backend; `fe` for frontend.
- **Business name:** a clear capability in lowercase, hyphen-separated words.
- **Approach:** `copilot`, `foundry`, or `opensource`.

Example: `af-be-customer-service-agent-copilot`.

Keep environment and developer names out of repository names. Repository owners must document approved exceptions. `.github`, governance, and shared platform repositories serve separate purposes and do not need the agent naming pattern.

<br />

### 02 · Task branches and pull requests

**One task, one focused change.**

Start from the latest `dev` → create a task branch → commit and test → open a PR into `dev` → review and merge → delete the merged task branch after checking dependencies.

| Branch | Use |
|---|---|
| `feature/<task>` | New functionality |
| `fix/<issue>` | Defect correction |
| `docs/<task>` | Documentation |
| `chore/<task>` | Maintenance |

A task can include several commits and collaborators. Create a new branch for the next task instead of accumulating unrelated work on permanent personal branches. Include test evidence and any deployment or migration impact in the PR.

Keep `dev` long-lived. Retain `prod`, `test`, or other established environment branches while the configured workflow needs them; never delete them during task cleanup. Profile and governance repositories follow their own configured default branches.

<br />

### 03 · Environments and releases

**Deliberate promotion to production.**

- Isolate development and production configuration, credentials, permissions, and state.
- Use the approved release path; promote to `prod` only where that branch is part of the configured workflow.
- Make deployment reproducible. Verify application behavior and document rollback, migration, and recovery requirements.
- Coordinate repository or branch renames with deployment identities, workflow references, integrations, and owners.
- Configure and verify required reviews, checks, and protections on the supported GitHub plan. Documentation alone does not enforce them.

<br />

### 04 · Scheduled workers

**Shared source, independent runtime.**

An agent's API and scheduled worker may share a repository while running as separate deployment resources. Sharing code does not mean sharing a running process.

Where Azure Container Apps Jobs is the selected runtime, use its configured job trigger; time-based schedules use cron. Make schedule ownership, configuration, retries, and duplicate protection explicit.

Existing `-cron` repositories remain separate until consolidation is implemented and validated. A separate cron repository is not required for every new agent.

<br />

### 05 · Quality, security, and ownership

**Evidence before release.**

- **Security and privacy:** least privilege, tenant and role boundaries, protected secrets, and no sensitive data in source or logs.
- **Correctness:** tested business rules, integrations, and data integrity, backed by acceptance evidence.
- **Reliability:** bounded retries, safe duplicate handling, meaningful health signals, and verified recovery behavior.
- **Delivery:** reviewed changes, validated environments, owned configuration, and a verified release path.
- **Ownership:** a responsible team, useful documentation, and a clear support and escalation path.

Use team-based access with the least privilege required. Designated administrators manage sensitive repository settings and deployment environments. GitHub access and cloud permissions are separate responsibilities.

<br />

---

**Need access or support?** Contact the repository owner through the approved internal channel.

This page is public. Never publish customer data, secrets, private infrastructure identifiers, or confidential operational details here.

<br />

<p align="center">
  <strong>SkySecure Agent Factory · Realize</strong><br />
  Focused on the business. Built for accountable delivery.
</p>
