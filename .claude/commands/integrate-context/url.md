---
description: Scrape and integrate documentation from provided URLs using Firecrawl tools
allowed-tools: Task(*), mcp__firecrawl__firecrawl_scrape(*), mcp__firecrawl__firecrawl_map(*), mcp__firecrawl__firecrawl_extract(*), Read(*), Edit(*), MultiEdit(*), Write(*), Glob(*), Grep(*), TodoWrite(*), TodoRead(*)
---

You are about to scrape and analyze documentation from URLs to assist with a task: $ARGUMENTS

## Argument Parsing

The arguments contain one or more URLs followed by an optional task description:
1. Extract all URLs from the arguments (anything starting with http:// or https://)
2. The remaining text after URLs (if any) is the specific task to accomplish
3. If no task is specified, use the scraped information to enhance your current work

## Firecrawl Documentation Scraping Process

### Step 1: Analyze URLs
Determine the best scraping approach:
- Single URL → Use `firecrawl_scrape`
- Multiple related pages → Process each with `firecrawl_scrape`
- Need to discover more pages → Use `firecrawl_map` first

### Step 2: Scrape Content

#### For Multiple URLs:
When multiple URLs are provided, use the Task tool to scrape them in parallel for better performance:

```javascript
// Launch parallel tasks for each URL
Task({
  description: "Scrape documentation page 1",
  prompt: "Use mcp__firecrawl__firecrawl_scrape to scrape and extract key information from <url1>. Focus on API methods, code examples, and implementation details."
})

Task({
  description: "Scrape documentation page 2", 
  prompt: "Use mcp__firecrawl__firecrawl_scrape to scrape and extract key information from <url2>. Focus on configuration options and best practices."
})

Task({
  description: "Scrape documentation page 3",
  prompt: "Use mcp__firecrawl__firecrawl_scrape to scrape and extract key information from <url3>. Focus on troubleshooting and common issues."
})
```

#### For Single URL:
```javascript
// For individual pages
mcp__firecrawl__firecrawl_scrape({
  url: "<url>",
  formats: ["markdown"],
  onlyMainContent: true,
  maxAge: 3600000  // Use cache if available (1 hour)
})

// If you need to discover related pages first
mcp__firecrawl__firecrawl_map({
  url: "<base-url>",
  search: "<optional-search-term>"
})
```

### Step 3: Extract Relevant Information
If structured data extraction is needed:
```javascript
mcp__firecrawl__firecrawl_extract({
  urls: ["<url1>", "<url2>"],
  prompt: "Extract API methods, parameters, and examples",
  schema: {
    // Define structure based on documentation type
  }
})
```

## Application Strategy

### With Explicit Task:
1. Scrape all provided URLs
2. Analyze content for task-relevant information
3. Apply findings to complete the specified task
4. Update any affected code or documentation

### Without Explicit Task (Context Enhancement):
1. Scrape all provided URLs
2. Extract key concepts, APIs, and patterns
3. Update your understanding of current work
4. Apply relevant findings to ongoing tasks
5. Update todo list if new requirements discovered

## Execution Guidelines

1. **Documentation Pages**:
   - Focus on code examples, API references, and usage patterns
   - Extract version-specific information if available
   - Note any prerequisites or dependencies

2. **Tutorial/Guide Pages**:
   - Extract step-by-step instructions
   - Identify best practices and common patterns
   - Note any warnings or important considerations

3. **API Reference Pages**:
   - Extract method signatures and parameters
   - Focus on return types and error handling
   - Capture example usage

4. **Blog/Article Pages**:
   - Extract technical insights and solutions
   - Identify relevant code snippets
   - Note any performance or architectural considerations

## Important Notes

- Firecrawl provides powerful scraping with automatic content cleaning
- Use `onlyMainContent: true` to filter out navigation and ads
- Leverage caching with `maxAge` for recently scraped pages
- For large documentation sites, consider using `firecrawl_map` to discover all relevant pages
- Always verify scraped content is current and applicable to your use case

Now proceeding to scrape and analyze documentation from: $ARGUMENTS