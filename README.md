# miniUni - a concurrent scripting language
[![release](https://github.com/gidra5/miniUni/actions/workflows/release.yml/badge.svg?cache-control=no-cache)](https://github.com/gidra5/miniUni/actions/workflows/release.yml)

A general-purpose multi-paradigm language, that aims to provide a scripting language with powerful concurrency and simple syntax.

## 🎯 Motivation

Why it must exist? Most scripting languages usually have very limited concurrency support, if any, are too noisy syntax or too minimalistic and fail domain completeness. This experiment aims to fill those gaps and provide new ideas for scripting language design.

## ✨ Main principles

These are the principles that guided the design of miniUni:
* 🌐 Everything is an expression. 
* 🚫 No explicit or implicit null value by default. 
* ⚡ Powerful concurrency: structured concurrency and async programming primitives 
* 🛠️ Effect handlers for powerful dependency injection and control of side effects
* ✍️ Flexible but minimalistic syntax, formatting friendly and minimizing indentation.
* 👐 Keep design unopinionated.
* 🔗 Keep design complete over the whole domain: make reasonable semantics for every possible feature input.

## ⚡ Quick Start
Download single executable interpreter for your platform from [releases](https://github.com/gidra5/miniUni/releases). All commands expected to be executed from the location of the interpreter.

To run programs do the following:
```
./miniUni run <file>
```

Or start REPL for interactive command-line usage:
```
./miniUni repl
```

## 🚀 Usage

Install syntax highlighting for vscode:
```
code --install-extension ./miniuni-highlight/miniuni-highlight-0.0.1.vsix
```

And start writing your first script. 
Create a `hello_world.uni` file and paste in:
```
print "Hello world!"
```

Then pass it to the interpreter to run:
```
./miniUni run hello_world.uni
```

And behold, the output:
```
Hello world!
```

You can also use REPL:
```
./miniUni repl
```

And paste commands you wish to execute:
```
>> print "Hello world!";
Hello world!
>> 
```


### 🖋️ Syntax

Syntax is a mix of functional and C-like syntax, so if you are coming from one of such languages (rust, haskell, js, elixir) it may look familiar to you
For a more complete set of examples and whats possible, check out the [examples](https://github.com/gidra5/miniUni/tree/master/examples) and [tests suites](https://github.com/gidra5/miniUni/tree/master/tests), but here is an overview of the syntax:

* Comments `// comment`, `/* block comment */`
* Values
  * String and number literals `"string"`, `1234`, `1.2`
  * Symbols `symbol()`
  * Channels `channel()`
  * Atoms `:atom`
* Variable `mut x := 1`, `x := 1`
* Assignment `x = 2`, `x.y = 123`
* Arithmetic
  * Add, subtract, multiply, divide `(1 + 2) * 3 / 5 - 6`
  * Exponentiation and modulo `2 ^ 8`, `28 % 12`
  * Increment decrement `++x, --x`, `x++, x--`
  * Increment-assign `x += 1`
* Boolean logic
  * Boolean and, or and negation `x and y or not z` 
  * Comparison `x < 3 or x > 2 or x <= 4 or x >= 6`
  * Equality and deep equality `x == 1 and x != 2`, `x === 1, 2 and x !== 2, 4`
  * Pattern matching `x is (a, b) and a == b + 1`
  * In operator `key in (x: 1, y: 2)`
* Data structures
  * Tuple `1, 2`, `x[0]`
  * Record `first: 1, second: 2`, `x.first`
  * Dictionary `["a"]: 1, ["b"]: 2`, `x["a"]`
* Loops
  * For loop `for x in y { print x }`
  * While loop `while x != 0 do x--`
  * Loop `loop print "infinity and beyond"`
* Branches
  * If branching `if x != 0 { print "in branch" }`
  * Match `switch x { 1 -> "x is 1", _ -> "x is not 1" }`
* Code blocks `y := { x:= 1; x + 1 }; print "x is not visible here"`
* Functions
  * Function literal `fn x, y do x + y` 
  * Function call `f x y`
  * Pipe `x |> f |> g` - passes value to `f` and then result passed to `g`
  * Lazy blocks `f { x }` - blocks are implicitly converted to functions (equivalent to `f fn { x }`)
* Concurrency
  * async/await `async f x`, `await x`
  * Parallel composition `1 | 2` - execute expressions in parallel
  * Channels `c <- 1`, `<- c`
* Pattern matching
  * Tuple pattern `x is (a, ...b, c)`
  * Record pattern `x is { a, b }`
* 3 forms for specifying body of a construct (function, `for` and `while` loops, `if` branching)
  * `fn x { y }` - explicit code block
  * `fn x do y` - implicit block until newline or semicolon
  * `fn x -> y` - implicit block until the end current grouping (block, parens, square brackets)
* Effect handlers 
  * `inject a: 1 { ... }` - injects value `1` as `a`
  * `inject [return_handler]: fn x { ... }` - handler to be called when no other effect is performed
  * `mask :a { ... }` - masks effect `a` (will forward handling to the next one)
  * `without :a { ... }` - forbids effect `a`
  * `handle (:a) x` - handles effect `a` with value `x`
  * `handler fn (callback, value) { ... }` - creates a handler with explicit callback

## 🤝 Contribution

The project's scope is already fixed, so it is not accepting any feature requests, only bug fixes and documentation. 

Repo is using [bun](https://bun.sh/) as a build tool, but works just as well with node.
At least one of them should already be installed on your machine.
To pull repo and start developing do the following:
```
git clone git@github.com:gidra5/miniUni.git
cd miniUni
npm i
npm run watch
```

This will start `vitest` in watch mode to automatically run test suits and show the results in terminal and browser.
