// Memory only. Refreshing clears the ID; it never enters the URL or web storage.
let account=null
export function setAccount(value){account=value}
export function getAccount(){return account}
