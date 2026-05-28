# Yeti Lounge — Move Smart Contract Agent Guidelines

**Project:** Yeti Lounge  
**Version:** MVP — CLAY Hackathon Round 2  
**Target Platform:** Sui Blockchain (Sui Move 2024)

This document establishes the official coding standards and architectural rules for writing Sui Move smart contracts in this repository. All coding agents must follow these guidelines.

---

## 1. Move 2024 Coding Patterns

### Prefer Method Syntax
Move 2024 automatically exports functions defined in the same module as a struct as methods if the first argument of the function is the struct itself.
- **Rule**: Implement accessor/mutation functions with the target object as the first parameter.
- **Example**:
  ```move
  // Do this:
  public fun name(yeti: &YetiProfile): String { yeti.name }
  // Allow callers to use: yeti.name()
  ```

### Implicit Default Imports
Sui Move 2024 implicitly imports key structures (such as `UID`, `TxContext`, and `transfer`).
- **Rule**: Do not add duplicate explicit imports for `sui::object::{Self, UID}`, `sui::tx_context::{Self, TxContext}`, or `sui::transfer` to avoid compiler duplicate alias warnings.

### Blockless Module Declarations
Move 2024 supports declaring modules without enclosing curly brackets `{}` around the file contents.
- **Rule**: Declare modules using the blockless syntax: `module package::module_name;` at the top of the file, terminating with a semicolon. Avoid wrapping the module contents in curly brackets.

---

## 2. Object Composability & Entry Points

To enable maximum composability for Programmable Transaction Blocks (PTBs):
1. **Rule — Core Functions**: Do NOT execute on-chain transfers (`transfer::transfer` or `transfer::share_object`) directly inside your core business logic functions. Instead, **return the created object** from the function.
2. **Rule — Entry Wrappers**: Write dedicated `public entry fun ..._entry` wrapper functions that invoke the core function and handle the actual on-chain transfer/share.

### Pattern Example:
```move
// 1. Composable core function (returns the object)
public fun create_badge(name: String, ctx: &mut TxContext): BadgeNFT {
    BadgeNFT {
        id: object::new(ctx),
        name,
    }
}

// 2. Entry wrapper (handles the transfer)
public entry fun create_badge_entry(name: String, ctx: &mut TxContext) {
    let badge = create_badge(name, ctx);
    transfer::transfer(badge, tx_context::sender(ctx));
}
```

---

## 3. General Conventions

- **Namespaces**:
  - Struct names must be **UpperCamelCase** (e.g., `YetiProfile`, `MemePost`).
  - Functions, variables, and module files must be **snake_case** (e.g., `create_profile`, `avatar_blob_id`).
- **Error Codes**:
  - Error constants must start with the uppercase letter `E` and use **UpperCamelCase** (e.g., `EProfileAlreadyExists`, `ENotOwner`).
- **Mutability visibility**:
  - Explicitly declare mutable parameters with `mut` (e.g., `let mut registry = ...`) when executing mutably borrowed methods.

---

**Before finishing any Move contract task:** Run `sui move build` and ensure compilation completes successfully with zero linter warnings.
