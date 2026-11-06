import { createConsentManager, type ConsentGate } from '../src/index.js';
const manager = createConsentManager({ purposes: ['analytics', 'advertising'] as const, defaultDecision: 'deny' });
const gate: ConsentGate<'analytics' | 'advertising'> = manager;
gate.isAllowed('analytics');
// @ts-expect-error Purpose-specific API rejects arbitrary strings
manager.grant('unknown');
manager.dispose();

import type { ConsentCapabilityV1, ConsentPurposeV1, ConsentSnapshotV1 } from '../src/index.js';
const managerForContract = createConsentManager({purposes:['analytics','ad-personalization'] as const});
const capabilityForConsumer: ConsentCapabilityV1 = managerForContract.capability;
const purposeForConsumer: ConsentPurposeV1 = 'ad-personalization';
const snapForConsumer: ConsentSnapshotV1 = capabilityForConsumer.snapshot();
void [capabilityForConsumer, purposeForConsumer, snapForConsumer];
managerForContract.dispose();

// @ts-expect-error Unsupported purposes cannot be created under frozen protocol v1.
createConsentManager({purposes:['personalization'] as const});
