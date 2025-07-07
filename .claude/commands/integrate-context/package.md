---
description: Look up library documentation using Context7 MCP tools for a specific task
allowed-tools: Task(*), mcp__context7__resolve-library-id(*), mcp__context7__get-library-docs(*), Read(*), Edit(*), MultiEdit(*), Write(*), Glob(*), Grep(*), TodoWrite(*), TodoRead(*)
---

You are about to research and integrate documentation for a library to complete the following task: $ARGUMENTS

## Task Analysis

Carefully analyze the user's task to:
1. Identify the library/package name mentioned
2. Understand what specific functionality or issue needs to be addressed
3. Determine which files or code areas may need updates

## Context7 Documentation Lookup Process

### Step 1: Resolve Library ID
Use `mcp__context7__resolve-library-id` to find the Context7-compatible library ID:
```javascript
mcp__context7__resolve-library-id({ 
  libraryName: "<extracted-library-name>" 
})
```

### Step 2: Fetch Relevant Documentation

#### For Multiple Documentation Topics:
When you need to search multiple aspects of a library's documentation, use the Task tool to parallelize the searches:

```javascript
// Launch multiple tasks for different documentation areas
Task({
  description: "Search API reference docs",
  prompt: "Use mcp__context7__get-library-docs to fetch API reference documentation for <library-id> focusing on core APIs and methods"
})

Task({
  description: "Search usage examples",
  prompt: "Use mcp__context7__get-library-docs to fetch usage examples and tutorials for <library-id>"
})

Task({
  description: "Search configuration docs",
  prompt: "Use mcp__context7__get-library-docs to fetch configuration and setup documentation for <library-id>"
})
```

#### For Single Documentation Fetch:
```javascript
mcp__context7__get-library-docs({
  context7CompatibleLibraryID: "<resolved-library-id>",
  topic: "<relevant-topics-from-task>",
  tokens: 5000  // MAX 5000 tokens, use tasks or multiple calls for additional context
})
```

### Step 3: Apply Knowledge to Task
Based on the documentation retrieved:
- If fixing errors: Analyze the current implementation and apply corrections
- If learning usage: Create or update implementation following best practices
- If general research: Update your understanding and todo list accordingly

## Execution Guidelines

1. **For Specific File Fixes**:
   - Read the mentioned file(s) first
   - Identify the library usage patterns
   - Fetch documentation for the specific APIs/features being used
   - Apply fixes based on the latest documentation

2. **For General Learning Tasks**:
   - Fetch comprehensive documentation
   - Update your todo list with implementation steps
   - Consider creating example implementations

3. **Documentation Strategy**:
   - Extract exact library names from the task description
   - Look for version-specific requirements if mentioned
   - Fetch documentation for core concepts first, then specific APIs
   - If initial documentation is insufficient, fetch additional topics

## Important Notes

- Context7 can access documentation from any open-source package on GitHub
- Always verify the library name extraction is correct
- If multiple libraries are mentioned, process them sequentially
- Consider fetching documentation for related topics if the initial fetch isn't sufficient
- Update todos as you learn new implementation requirements

Now proceeding to analyze and execute your task: $ARGUMENTS