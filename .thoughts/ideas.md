# AI Context Manager App

Goal: Create a locally hosted web app that has a convienient interface for chatting with LLMs using APIs and intelligently managing context. This includes having a dynamic LLM managed memory system and a set of human written context about my life and different circumstances.

## The Features

### Interface

The app should be a sleek web based LLM interface, that runs locally, handling prompts with LLM APIs like GPT, Gemini, and Claude. There should be a model selector in the app, and I should be able to switch models on a per-prompt basis. Previous chats should be saved in a sidebar. The UI should be reminiscent of other online chatbots like ChatGPT.

### Context Management

The novelty comes from a unique context manager. There should be another page of the app where I can write and mangage user-generated contexts. These would include natural language descriptions of relevant contexts as markdown files. When starting a new chat, I should be able to initalize and agent with specific context(s) that I've previously written to make specialized agents for different neccesary tasks.

Additionally, as each chat goes on, the agent should decide what knowledge is important to know, and is not already found in another context, and it should add it to its LLM-sustained memory. This decision should be done quickly with a small model (like maybe a flash model) and retrival from this document can be handeled using RAG. Some things that could be stored here are like my personal interests, facts about my family memebers not found elsewhere, and other important context. This can be stored as either a single file, multiple files, or in a database with specific tags. I should also be able to manage this LLM-generated context in the context page of the app.

### Rules and Commands

The last piece of context management needed for V1 is a robust rules and commands system. I should be able to write rules that the LLM always follows, and I should be able to write natural language commands that I can invoke using /[rule name]. These rules will also be human-managed.

### Tech Stack

Write the app using Flask, and utilizing python libraries for accessing the APIs.