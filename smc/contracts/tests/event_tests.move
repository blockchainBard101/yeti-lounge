#[test_only]
module contracts::event_tests;

use sui::test_scenario;
use sui::clock;
use contracts::event::{Self, EventRegistry, YetiEvent};
use contracts::profile::{Self, YetiRegistry, YetiProfile};

const USER: address = @0x1;
const ATTENDEE: address = @0x2;

#[test]
fun test_create_and_rsvp() {
    let mut scenario = test_scenario::begin(USER);

    // Initialize Profile module
    test_scenario::next_tx(&mut scenario, USER);
    {
        profile::test_init(test_scenario::ctx(&mut scenario));
    };

    // Initialize Event module
    test_scenario::next_tx(&mut scenario, USER);
    {
        event::test_init(test_scenario::ctx(&mut scenario));
    };

    // Create YetiProfile for USER
    test_scenario::next_tx(&mut scenario, USER);
    {
        let mut registry = test_scenario::take_shared<YetiRegistry>(&scenario);
        profile::create_profile_entry(
            &mut registry,
            b"test_yeti".to_string(),
            b"blob123".to_string(),
            b"bio".to_string(),
            test_scenario::ctx(&mut scenario)
        );
        test_scenario::return_shared(registry);
    };

    // Create an Event
    test_scenario::next_tx(&mut scenario, USER);
    {
        let mut event_reg = test_scenario::take_shared<EventRegistry>(&scenario);
        let yeti_profile = test_scenario::take_from_sender<YetiProfile>(&scenario);

        event::create_event_entry(
            &mut event_reg,
            &yeti_profile,
            b"AMA Session".to_string(),
            b"Join us!".to_string(),
            1715000000,
            2, // capacity 2
            test_scenario::ctx(&mut scenario)
        );

        test_scenario::return_shared(event_reg);
        test_scenario::return_to_sender(&scenario, yeti_profile);
    };

    // RSVP as ATTENDEE
    test_scenario::next_tx(&mut scenario, ATTENDEE);
    {
        let mut yeti_event = test_scenario::take_shared<YetiEvent>(&scenario);
        let clock_obj = clock::create_for_testing(test_scenario::ctx(&mut scenario));

        event::rsvp_entry(
            &mut yeti_event,
            &clock_obj,
            test_scenario::ctx(&mut scenario)
        );

        assert!(event::rsvp_count(&yeti_event) == 1, 0);

        test_scenario::return_shared(yeti_event);
        clock::destroy_for_testing(clock_obj);
    };

    test_scenario::end(scenario);
}
