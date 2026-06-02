module contracts::event;

use std::string::String;
use sui::event;
use sui::clock::{Self, Clock};
use contracts::profile::YetiProfile;

// --- Errors ---
const EEventAtCapacity: u64 = 0;
const EAlreadyRSVPd: u64 = 1;

// --- Objects ---

/// Global registry tracking all events
public struct EventRegistry has key {
    id: UID,
    total_events: u64,
}

/// Represents an Event that users can RSVP to
public struct YetiEvent has key {
    id: UID,
    creator: address,
    title: String,
    description: String,
    start_time: u64,
    capacity: u64,
    rsvp_count: u64,
    attendees: vector<address>,
}

/// Non-transferable Badge NFT representing attendance/RSVP
public struct BadgeNFT has key {
    id: UID,
    event_id: ID,
    event_title: String,
    attendee: address,
    timestamp: u64,
}

// --- Events ---

public struct EventCreated has copy, drop {
    event_id: ID,
    creator: address,
    title: String,
    capacity: u64,
}

public struct UserRSVPd has copy, drop {
    event_id: ID,
    attendee: address,
    badge_id: ID,
}

// --- Constructor ---

fun init(ctx: &mut TxContext) {
    let registry = EventRegistry {
        id: object::new(ctx),
        total_events: 0,
    };
    transfer::share_object(registry);
}

#[test_only]
public fun test_init(ctx: &mut TxContext) {
    init(ctx)
}

// --- Entry & Public Functions ---

/// Create a new event (Permissionless, but requires a YetiProfile)
public fun create_event(
    registry: &mut EventRegistry,
    profile: &YetiProfile,
    title: String,
    description: String,
    start_time: u64,
    capacity: u64,
    ctx: &mut TxContext
): YetiEvent {
    let sender = tx_context::sender(ctx);
    // Ensure the creator is the owner of the profile
    assert!(profile.owner() == sender, 2);

    let event_id = object::new(ctx);
    let id_val = object::uid_to_inner(&event_id);

    let new_event = YetiEvent {
        id: event_id,
        creator: sender,
        title,
        description,
        start_time,
        capacity,
        rsvp_count: 0,
        attendees: vector::empty<address>(),
    };

    registry.total_events = registry.total_events + 1;

    event::emit(EventCreated {
        event_id: id_val,
        creator: sender,
        title,
        capacity,
    });

    new_event
}

entry fun create_event_entry(
    registry: &mut EventRegistry,
    profile: &YetiProfile,
    title: String,
    description: String,
    start_time: u64,
    capacity: u64,
    ctx: &mut TxContext
) {
    let new_event = create_event(registry, profile, title, description, start_time, capacity, ctx);
    transfer::share_object(new_event);
}

/// RSVP to an event. Mints a non-transferable BadgeNFT to the attendee.
public fun rsvp(
    yeti_event: &mut YetiEvent,
    clock: &Clock,
    ctx: &mut TxContext
): BadgeNFT {
    let sender = tx_context::sender(ctx);

    // Check capacity
    assert!(yeti_event.rsvp_count < yeti_event.capacity, EEventAtCapacity);
    
    // Check if already RSVP'd (simple vector scan, fine for small events, would use Table for scale)
    let mut i = 0;
    while (i < vector::length(&yeti_event.attendees)) {
        assert!(*vector::borrow(&yeti_event.attendees, i) != sender, EAlreadyRSVPd);
        i = i + 1;
    };

    yeti_event.rsvp_count = yeti_event.rsvp_count + 1;
    vector::push_back(&mut yeti_event.attendees, sender);

    let badge_id = object::new(ctx);
    let badge_id_val = object::uid_to_inner(&badge_id);

    let badge = BadgeNFT {
        id: badge_id,
        event_id: object::uid_to_inner(&yeti_event.id),
        event_title: yeti_event.title,
        attendee: sender,
        timestamp: clock::timestamp_ms(clock),
    };

    event::emit(UserRSVPd {
        event_id: object::uid_to_inner(&yeti_event.id),
        attendee: sender,
        badge_id: badge_id_val,
    });

    badge
}

entry fun rsvp_entry(
    yeti_event: &mut YetiEvent,
    clock: &Clock,
    ctx: &mut TxContext
) {
    let badge = rsvp(yeti_event, clock, ctx);
    // Transfer soulbound NFT to sender. Notice BadgeNFT lacks `store` or `transfer` capability!
    transfer::transfer(badge, tx_context::sender(ctx));
}

// --- Getters ---

public fun title(e: &YetiEvent): String { e.title }
public fun capacity(e: &YetiEvent): u64 { e.capacity }
public fun rsvp_count(e: &YetiEvent): u64 { e.rsvp_count }
