# Yeti Lounge 🥶💧 — Project Roadmap

This roadmap outlines the milestones, timelines, and deliverables for **Yeti Lounge**, the SocialFi community hub for Lofi The Yeti on Sui.

---

## 🗺️ Phase 1: Hackathon MVP (May – June 30, 2026)
*Goal: Deliver a fully functional, highly interactive, and beautifully designed web application on Sui Testnet for the CLAY Hackathon Round 2.*

### ❄️ Week 1: Identity & zkLogin Integration (Completed)
- [x] Install Enoki SDK client dependencies.
- [x] Implement client-side `EnokiWrapper` for secure authentication state.
- [x] Implement gasless Google Sign-In redirect flow via zkLogin.
- [x] Connect header wallet components to read live Sui Testnet addresses.
- [x] Scaffold PostgreSQL indexer schema and NestJS backend framework.

### ❄️ Week 2: Move Contracts & Profile Creation (June 1 – June 7)
- [ ] Write `profile.move` contract:
  - Define `YetiProfile` resource holding handle, bio, and avatar blob reference.
  - Implement handle resolution/registration logic.
- [ ] Connect NestJS Gas Sponsor Guardian module to handle gas pools for `create_profile`.
- [ ] Integrate SuiNS SDK on frontend to display `username.yeti` handles.

### ❄️ Week 3: Meme Social Feed & Walrus Storage (June 8 – June 14)
- [ ] Deploy `post.move` contract:
  - Model `MemePost` shared objects.
  - Write `yerr_post` reaction logic.
- [ ] Integrate Walrus storage client on frontend:
  - Users upload memes directly to Walrus nodes and obtain a `BlobID`.
  - Store the `BlobID` inside the Sui `MemePost` object.
- [ ] Render a masonry layout grid on `/feed` querying posts from the PostgreSQL indexer API.

### ❄️ Week 4: Events, RSVPs & Badges (June 15 – June 21)
- [ ] Write `event.move` contract allowing events creation, ticketing, and RSVPs.
- [ ] Write attendance proof: RSVPing mints a non-transferable attendee `BadgeNFT` into the user’s profile.
- [ ] Implement event details and RSVP UI flows in `/events`.

### ❄️ Week 5: Quests, Rewards & Final Polish (June 22 – June 30)
- [ ] Write quest checklists contract `rewards.move` with token drip logic.
- [ ] Integrate Framer Motion micro-animations, background lofi music player presets, and ice particle flurries.
- [ ] Run end-to-end security audits on Move smart contracts.
- [ ] Record demo video and submit for hackathon.

---

## 🌊 Phase 2: Post-MVP & Mainnet Readiness (Q3 2026)
*Goal: Harden security, scale infrastructure, and launch on Sui Mainnet with the Lofi Foundation.*

- **Sponsor Rate-Limiting**: Deploy Redis rate-limiting inside NestJS to prevent Sybil attacks and gas draining.
- **Auto-Lease Renewal**: Deploy cron schedulers on the backend to automatically renew storage leases for popular media blobs on the Walrus network.
- **WebSocket Gateway**: Implement real-time feed updates and notifications using Socket.io.
- **Holder Verification**: Build off-chain validation mechanisms checking for Mystic Yeti NFT ownership or $LOFI staking balances to unlock holder-only spaces.

---

## 🏔️ Phase 3: Community & Feature Expansion (Q4 2026+)
*Goal: Turn Yeti Lounge into the ultimate home for all Lofi community events, merch, and charity engagement.*

- **AI Meme Generator**: Build an integrated AI canvas tool allowing users to generate Yeti-themed art and directly mint the best creations.
- **Glacier Charity Fund Integration**: Create a micro-donation portal where SUI/LOFI donations automatically mint progressive dynamic "Impact NFTs" representing liters of water cleaned.
- **Merch Store Bridge**: Allow token redemption or discounts for physical Lofi merch based on earned badge achievements.
