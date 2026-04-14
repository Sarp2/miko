import process from 'node:process';

process.env.MIKO_RUNTIME_PROFILE = 'dev';

// TODO: Implement CLI feature for pacakage in the future
// process.env.KANNA_DISABLE_SELF_UPDATE = "1"
// await import("../src/server/cli")

const portIndex = process.argv.indexOf('--port');                                                      
const port = portIndex !== -1 ? Number(process.argv[portIndex + 1]) : undefined;
                                                                                                         
const { startServer } = await import('../src/server/index');                                           
await startServer({ port });