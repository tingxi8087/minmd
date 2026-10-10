import { describe, expect, it } from "vitest";
import { curl, example, makeUrl, endpoints, redact } from "../src/views/ApiDebug/model";
describe('debug request model', () => {
  it('keeps reusable history values but clears nested secrets', () => {
    expect(redact({name:'Alice',password:'private',profile:{token:'private'},items:[{api_key:'private'}]}, '', '')).toEqual({name:'Alice',password:'',profile:{token:''},items:[{api_key:''}]});
  });
  it('encodes path and query and omits unchecked values', () => {
    expect(makeUrl('/api/items/{id}', [{name:'id',value:'a/b',enabled:true}], [{name:'q',value:'a & b',enabled:true},{name:'skip',value:'x',enabled:false}])).toBe('/api/items/a%2Fb?q=a+%26+b');
    expect(() => makeUrl('/api/{id}', [{name:'id',value:'',enabled:true}], [])).toThrow();
  });
  it('generates nested examples without sensitive defaults', () => {
    expect(example({type:'object',properties:{password:{default:'secret'},page:{type:'integer',default:1},profile:{$ref:'#/components/schemas/profile'}}}, {paths:{},components:{schemas:{profile:{type:'object',properties:{token:{default:'sensitive'}}}}}})).toEqual({password:'',page:1,profile:{token:''}});
  });
  it('redacts credentials from curl including nested JSON and query', () => {
    const text = curl({method:'POST',url:'/api/login?token=secret',auth:'custom',token:'secret',headers:{'X-API-Key':'secret'},body:JSON.stringify({password:'secret',nested:{refreshToken:'secret'},name:'hello'})},'http://localhost');
    expect(text).not.toContain('secret'); expect(text).toContain('hello'); expect(text).toContain('已隐藏');
  });
  it('ignores non-operation path metadata', () => {
    expect(endpoints({paths:{'/api/items':{get:{summary:'Items'},parameters:{}}}})).toHaveLength(1);
  });
});

it("uses declared examples while clearing nested secrets", () => {
 expect(example({type:"object",example:{name:"示例", password:"secret", profile:{token:"secret"}}},{paths:{}})).toEqual({name:"示例",password:"",profile:{token:""}});
 expect(example({type:"string",example:"Alice",default:"fallback"},{paths:{}})).toBe("Alice");
});
