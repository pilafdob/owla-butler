// A stand-in for `claude` used by tests/claude.test.ts. After the user message
// it asks OWLA's MCP server to call the tool named in argv[2], then ends the
// turn with the MCP response as the result text. It never contacts a model.
import {createInterface} from 'node:readline';
const tool=process.argv[2];
const send=value=>process.stdout.write(JSON.stringify(value)+'\n');
for await(const line of createInterface({input:process.stdin})){
 const message=JSON.parse(line);
 if(message.type==='control_request'&&message.request_id==='owla-init')send({type:'control_response',response:{subtype:'success',request_id:'owla-init',response:{}}});
 else if(message.type==='user')send({type:'control_request',request_id:'mcp-1',request:{subtype:'mcp_message',server_name:'owla',message:{jsonrpc:'2.0',id:7,method:'tools/call',params:{name:tool,arguments:{}}}}});
 else if(message.type==='control_response'&&message.response?.request_id==='mcp-1'){send({type:'result',subtype:'success',is_error:false,result:JSON.stringify(message.response.response.mcp_response.result)});break;}
}
