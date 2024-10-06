# miniUni - a concurrent scripting language
[![release](https://github.com/gidra5/miniUni/actions/workflows/release.yml/badge.svg?cache-control=no-cache)](https://github.com/gidra5/miniUni/actions/workflows/release.yml)

A general-purpose multi-paradigm language, that aims to provide a scripting language with powerful concurrency and simple syntax.

## Motivation

Why it must exist? Most scripting languages usually have very limited concurrency support, if any, and either too noisy syntax or too minimalistic. This experiment aims to fill those gaps and provide new ideas for scripting language design.

## Main principles
* Everything is an expression. 
* No explicit or implicit null value. 
* Powerful concurrency: structured concurrency and async programming primitives 
* Effect handlers for powerful dependency injection and control of side effects
* Flexible but minimalistic syntax, formatting friendly and minimizing indentation.
* Extend common syntax with broader semantics.

## Quick Start
Download single executable interpreter for your platform from [releases](https://github.com/gidra5/miniUni/releases). All commands expected to be executed from the location of the artifact.

To run programs do the following:
```
./miniUni run <file>
```

Or start REPL for interactive command-line usage:
```
./miniUni repl
```

## Usage

To write your first script create a `hello_world.uni` file and paste in:
```
print "Hello world!"
```

Then pass it to the interpreter to run:
```
./miniUni run *file*
```

And behold, the output:
```
Hello world!
```

### Syntax
To learn the language a bit closer, here is a quick overview of the syntax:

* Line comments `// comment`
* Block comments `/* nested /* block */ comment */`
* Values
  * Strings `"string"`
  * Ints `1234`
  * Floats `1.2`
  * Symbols `symbol()`
  * Channels `channel()`
  * Atoms `:atom`
* Mutable variable `mut x := 1`
* Immutable variable `x := 1`
* Assignment `x = 2`
* Field assignment `x.y = 123`
* Arithmetic
  * Add, sub, mult, div `(1 + 2) * 3 / 5 - 6`
  * Exponentiation `2 ^ 8`
  * Modulo `28 % 12`
  * Increment decrement `++x, --x`
  * Post increment decrement `x++, x--`
  * Increment-assign `x += 1`
* Boolean logic
  * Boolean `and` and `or` `x and y or z`
  * Comparison `x < 3 or x > 2 or x <= 4 or x >= 6`
  * Equality `x == 1 and x != 2`
  * Deep Equality `x === 1, 2 and x !== 2, 4`
  * Pattern matching `x is (a, b) and a == b + 1`
  * In operator `key in (x: 1, y: 2)`
  * Negation `not x` or `not (x, y)`
* Data structures
  * Tuple `1, 2`
  * Record `first: 1, second: 2`
  * Dictionary `"a": 1, "b": 2`
  * Access `x[0], x.field, x["entry"]`
* Loops
  * For loop `for x in y do print x`
  * For loop map `y = for x in y do x + 1`
  * For loop filter `y = for x in y do if x > 1 do x`
  * While loop `while x != 0 do x--`
  * Loop `loop print "infinity and beyond"`
  * Break loops `loop if x == 0: break() else x = x + 1`
  * Continue loops `loop { if x != 0 { print "in loop branch"; continue() }; print "not in branch loop" }`
* Branches
  * If branching `if x != 0 { print "in branch" }`
  * If else branching `if x != 0 { print "in branch" } else { print "in else branch" }`
  * Match `switch x { 1 -> print "x is 1", 2 -> print "x is 2", _ -> print "x is not 1 or 2" }`
* Code blocks
  * Block `y := { x:= 1; x + 1 }; print "x is not visible here"`
  * Break from block `y := { break 1; print "not printed" }`
  * Label code `labeled::{ x:= { labeled.break 1; print "not printed" }; print "not printed as well"; x }`
* Functions
  * Function literal `fn x do x+1`
  * Arrow function `x -> x + 1` - a single argument function
  * Function call `x 1`
  * Pipe `x |> f |> g` - passes value to `f` and then result passed to `g`
  * Curried multiple arguments `fn x, y -> x + y` (equivalent to `x -> y -> x + y`)
  * blocks passed as arguments are implicitly converted to functions. So `f { x }` is equivalent to `f (fn { x })`
* Concurrency
  * Parallel composition `1 | 2` - execute expressions in parallel
  * Select `c1 + c2` - channel that will receive value from first channel to resolve
  * Send to channel `c <- 1` - send value and block until received
  * Receive from channel `<- c` - receive value, blocking if unavailable
  * Try sending `c <-? 1` - try sending value, without blocking, instead returning status.
  * Try receiving `?<- c` - try receiving value if it is available.
  * async expression `async f x` - will execute expression in a separate thread
  * await `await x` - awaits result from async expression
* Pattern matching
  * Placeholder pattern `_`
  * Pin pattern `x is ^y`
  * Constant pattern `x is 1`
  * Tuple pattern `x is (a, b)`
  * Bind pattern `x is (a, b) @ c`
  * With default value `x is (a = 4, b)`
  * Rest pattern `x is (a, ...b, c)`
  * Multiple bindings for same name `x is (a, a)`
  * Record pattern `x is { a, b }`
  * Dynamic key record pattern `x is { ["on" + a]: c, b }`
  * Strict and loose pattern matching `x is like { a, b }` and `x is like { a, b: strict { b, c } }`
* 3 forms for specifying body of a construct (function, `for` and `while` loops, `if` branching)
  * `fn x { y }` - explicit code block
  * `fn x do y` - implicit block until newline or semicolon
  * `fn x -> y` - implicit block until the end current grouping (block, parens, square brackets)
* Effect handlers 
  * `inject a: 1 { ... }` - injects value `1` as `a`
  * `mask "a" { ... }` - masks handler `a` from handlers (will skip first handler and pick the next one)
  * `without "a" { ... }` - forbids emitting effect `a` inside scope
  * `handle "a" x` - handles effect `a` with value `x`
  * `handler fn (callback, value) { ... }` - creates a handler with explicit callback
  * `inject [return_handler]: fn x { ... }` - injects handler that will be called when no effect is performed

Syntax is a mix of functional and C-like syntax, so if you are coming from one of such languages (rust, haskell, js, elixir) it may look familiar to you
For a more complete set of examples and whats possible, check out the [examples](https://github.com/gidra5/miniUni/tree/main/examples) and [tests suites](https://github.com/gidra5/miniUni/tree/main/tests)

## Contribution

The project is not for continuous development, so it is not accepting any feature requests, only bug fixes and documentation. 

To pull repo and start developing do the following:
```
git clone git@github.com:gidra5/miniUni.git
cd miniUni
npm i
npm run watch
```

This will start watching for changes in the source files, automatically run test suits and show the results in terminal and in browser.
