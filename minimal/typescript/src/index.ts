#!/usr/bin/env node
import "dotenv/config";
import { main } from "./app.js";

const debug = process.argv.includes("-d") || process.argv.includes("--debug");
main({ debug });
