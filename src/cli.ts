#!/usr/bin/env node
import { startServer } from "./server.js";

startServer({
  input: process.stdin,
  output: process.stdout
});
