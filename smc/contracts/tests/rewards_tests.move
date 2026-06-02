#[test_only]
module contracts::rewards_tests;

use sui::test_scenario;
use contracts::rewards::{Self, QuestRegistry, Quest};
use contracts::profile::{Self, YetiRegistry, YetiProfile, AdminCap};

const ADMIN: address = @0xA;
const USER: address = @0xB;

#[test]
fun test_complete_quest() {
    let mut scenario = test_scenario::begin(ADMIN);

    // Initialize Profile module
    test_scenario::next_tx(&mut scenario, ADMIN);
    {
        profile::test_init(test_scenario::ctx(&mut scenario));
    };

    // Initialize Rewards module
    test_scenario::next_tx(&mut scenario, ADMIN);
    {
        rewards::test_init(test_scenario::ctx(&mut scenario));
    };

    // Create a Quest
    test_scenario::next_tx(&mut scenario, ADMIN);
    {
        let admin_cap = test_scenario::take_from_sender<AdminCap>(&scenario);
        let mut quest_reg = test_scenario::take_shared<QuestRegistry>(&scenario);

        rewards::add_quest(
            &admin_cap,
            &mut quest_reg,
            b"Move Academy".to_string(),
            b"Complete 5 Move lessons".to_string(),
            50, // reward 50 flurries
            test_scenario::ctx(&mut scenario)
        );

        test_scenario::return_shared(quest_reg);
        test_scenario::return_to_sender(&scenario, admin_cap);
    };

    // Create a Profile for USER
    test_scenario::next_tx(&mut scenario, USER);
    {
        let mut registry = test_scenario::take_shared<YetiRegistry>(&scenario);
        profile::create_profile_entry(
            &mut registry,
            b"learner".to_string(),
            b"blob123".to_string(),
            b"learning move".to_string(),
            test_scenario::ctx(&mut scenario)
        );
        test_scenario::return_shared(registry);
    };

    // Admin completes quest for USER
    test_scenario::next_tx(&mut scenario, ADMIN);
    {
        let admin_cap = test_scenario::take_from_sender<AdminCap>(&scenario);
        let quest = test_scenario::take_shared<Quest>(&scenario);
        
        // Take the USER's profile from the shared registry? No, YetiProfile is a personal object!
        // We have to simulate the user passing their YetiProfile to the Admin, 
        // or Admin calls it in a PTB where the user provides the Profile.
        // Let's just use test_scenario::take_from_address to get the User's profile.
        let mut user_profile = test_scenario::take_from_address<YetiProfile>(&scenario, USER);

        // Check initial balance (100)
        assert!(profile::flurries_balance(&user_profile) == 100, 0);

        rewards::complete_quest_entry(
            &admin_cap,
            &quest,
            &mut user_profile,
            test_scenario::ctx(&mut scenario)
        );

        // Check new balance (100 + 50 = 150)
        assert!(profile::flurries_balance(&user_profile) == 150, 1);

        test_scenario::return_shared(quest);
        test_scenario::return_to_sender(&scenario, admin_cap);
        test_scenario::return_to_address(USER, user_profile);
    };

    test_scenario::end(scenario);
}
