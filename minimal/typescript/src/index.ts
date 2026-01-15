#!/usr/bin/env node
import "dotenv/config";
import { main } from "./core/main.js";

const debug = process.argv.includes("-d") || process.argv.includes("--debug");
main({ debug });
