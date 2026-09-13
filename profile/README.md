<p align="center">
  <img src="https://raw.githubusercontent.com/skysecure-agent-factory/.github/prod/profile/assets/realize-banner.svg" alt="SkySecure Agent Factory — Build for the business. Deliver through Realize." width="100%" />
</p>

<p align="center">
  <strong>Business-first agents. Disciplined engineering. Repeatable deployment.</strong>
</p>

<p align="center">
  <a href="#the-factory">Our mission</a> ·
  <a href="#three-implementation-approaches">Approaches</a> ·
  <a href="#developer-guide">Developer guide</a> ·
  <a href="#engineering-together">Engineering standards</a>
</p>

---

## The factory

**SkySecure Agent Factory is where focused business use cases become purpose-built AI agents for Realize.**

We start with a specific business need, define the expected outcome, build the agent and its integrations, and validate the complete workflow. Realize is the destination for packaging and delivering those agents through an automated deployment experience.

Our aim is a repeatable path from a useful idea to an agent that can be deployed, supported, and improved.

| Start with the business | Engineer the whole workflow | Deliver through Realize |
|---|---|---|
| Define the users, problem, boundaries, and measurable outcome. | Build the agent, integrations, access controls, tests, and operational behavior. | Package configuration and permissions, validate deployment, and establish ownership. |

## Three implementation approaches

Choose the approach that fits the business workflow, customer environment, and operating requirements.

| Approach | What it means | Repository keyword |
|---|---|---|
| **Microsoft Copilot** | Agents built around the Microsoft Copilot ecosystem and its supported integration surfaces. | `copilot` |
| **Microsoft Foundry** | Agents using Microsoft's Azure-hosted AI models and services, including Azure OpenAI. | `foundry` |
| **Open-source models** | A planned approach using selected open-source or open-weight models, with licensing and hosting requirements evaluated per model. | `opensource` |

Availability is **agent-specific**. An approach listed here does not mean every agent supports it today. Open-source delivery is a roadmap direction; model suitability, licensing, security, and infrastructure requirements must be validated before release.

## Developer guide

**Every developer must use the [SkySecure AI Agent Engineering and Production Guide](https://skysecure-agent-factory.github.io/.github/) as the working reference for building and releasing agents.**

The standard applies across business use cases and implementation approaches, including new agents added to this organization. It covers architecture, security, tenant isolation, data integrity, testing, reliability, deployment, and operations.

| Start with a verified scope | Build with evidence | Release against the standard |
|---|---|---|
| Complete [Step 0: project profile](https://skysecure-agent-factory.github.io/.github/#step-0) and identify which controls apply. | Implement the applicable controls and retain test, evaluation, and recovery evidence with the project. | Complete [Step 23: final release gate](https://skysecure-agent-factory.github.io/.github/#step-23); resolve applicable blockers before approval. |

Following the guide is required; it is not a guarantee that checks pass. Production approval requires verified results for the actual agent, customer environment, and release. Keep customer data and confidential project evidence in approved access-controlled locations.

The guide has one stable URL. Its designated owner edits [`docs/index.html`](https://github.com/skysecure-agent-factory/.github/blob/prod/docs/index.html) on a task branch, raises a PR into `prod`, and merges after automated guide checks pass. Each merge deploys the public guide through GitHub Actions and GitHub Pages, without a laptop publisher or manual upload. This documentation repository does not require a separate human approval; application repositories keep their own review and release rules. Foreground guide pages check for updates at most once every five minutes; hidden tabs do not poll. Allow time for deployment, then refresh or reopen the same URL if needed. This repository and its PRs are public: never commit confidential information, even on an unmerged branch.

## From use case to deployment

**Define → Build → Validate → Review → Deploy → Operate**

1. **Define:** agree on the business outcome, data boundaries, acceptance criteria, and owner.
2. **Build:** implement the agent and integrations on a focused task branch.
3. **Validate:** test functionality, authorization, data integrity, failure recovery, and configuration.
4. **Review:** submit a pull request with test evidence and any deployment or migration impact.
5. **Deploy:** use the approved delivery workflow and environment-specific configuration; complete required consent and access setup.
6. **Operate:** verify the deployed outcome, monitor failures, and maintain a practical rollback or recovery path.

Automated deployment does not remove the need for customer authorization, correct permissions, or environment validation. Production readiness is demonstrated by evidence for that agent and deployment—not by its repository name or a successful build alone.

## Engineering together

### A consistent repository name

```text
af-{layer}-{business-name}-agent-{approach}
```

| Part | Standard |
|---|---|
| `af` | Agent Factory namespace |
| Layer | `be` for backend; `fe` for frontend |
| Business name | Clear business capability in lowercase, hyphen-separated words |
| `agent` | Identifies the product as an agent |
| Approach | `copilot`, `foundry`, or `opensource`; document approved exceptions |

Illustrative names: `af-be-customer-service-agent-copilot` and `af-be-customer-service-agent-foundry`. A frontend follows the same pattern with `fe`; approved implementation exceptions must be documented by the repository owner.

Keep environment names and developer names out of agent repository names. `.github`, governance, and genuinely shared platform repositories have separate purposes and are not forced into the agent naming pattern.

### One task. One branch. One reviewed change.

| Branch | Purpose | Lifecycle |
|---|---|---|
| `dev` | Default integration branch for agent development and validation. | Long-lived |
| `prod` | Approved production delivery, **where configured** by the repository's release model. | Long-lived where used |
| `test` or another agreed environment branch | A dedicated role required by an established workflow—not a default requirement. | Retain while its workflow depends on it |
| `feature/<task>` | One focused feature. | Delete after merge and dependency checks |
| `fix/<issue>` | One focused defect correction. | Delete after merge and dependency checks |
| `docs/<task>` or `chore/<task>` | Focused documentation or maintenance work. | Delete after merge and dependency checks |

**The normal development loop:** start from the latest `dev` → create a task branch → commit and test → open a PR into `dev` → review and merge → delete the merged task branch.

A task can contain several commits, and several developers can collaborate on it. Use a new branch for the next task; avoid permanent personal branches that accumulate unrelated work. Never delete long-lived branches as part of routine task cleanup. The public profile and governance repositories follow their own configured default branches.

This public documentation repository uses `prod` as its release branch. The earlier `guide-live` branch is retained only as a migration recovery copy; it is no longer a publishing source.

### Separate environments, deliberate releases

- Keep development and production configuration, credentials, permissions, and state appropriately isolated.
- Use the repository's approved release path. Promote to `prod` only where that branch is part of the configured deployment workflow.
- Make deployments reproducible and verify the resulting application behavior. Document rollback, migration, and recovery requirements.
- Coordinate repository or branch renames with deployment identities, workflow references, integrations, and owners.
- Required reviews, checks, and protection settings must be configured and verified for the repository and supported GitHub plan. Documentation alone does not enforce them.

### Clear boundaries for scheduled work

An agent's API and scheduled worker may share a repository while running as separate deployment resources. Sharing source code does not mean they share a running process.

Where Azure Container Apps Jobs is the selected runtime, scheduled work uses its configured job trigger; time-based schedules use cron. Keep ownership, retries, duplicate protection, and schedule configuration explicit.

Existing `-cron` repositories remain separate until a deliberate consolidation is implemented and validated. They are not a naming requirement for every new agent.

### A shared quality bar

| Area | Expected before release |
|---|---|
| **Security & privacy** | Least-privilege access, tenant and role boundaries, protected secrets, and no sensitive data in source or logs. |
| **Correctness** | Tests and acceptance evidence for business rules, integrations, and data integrity. |
| **Reliability** | Bounded retries, safe duplicate handling, meaningful health signals, and recovery behavior. |
| **Delivery** | Reviewed changes, environment validation, owned configuration, and a verified release path. |
| **Ownership** | A responsible team, useful documentation, and a clear support and escalation path. |

### Access and collaboration

Use team-based access with the least privilege required. Developers need contribution access; designated repository administrators manage sensitive settings and deployment environments. GitHub permissions and cloud permissions are separate responsibilities.

Never include customer data, secrets, private infrastructure identifiers, or confidential operational details in public documentation. For source access, onboarding, or support, use the approved internal channel and contact the relevant repository owner.

---

<p align="center">
  <strong>SkySecure Agent Factory · Realize</strong><br />
  <sub>Focused on the business. Built for accountable delivery.</sub>
</p>
