import {beforeEach,describe,expect,it,vi} from 'vitest';
import {calculateNetSalary} from '../utils/salary-calculation.js';

const mocks=vi.hoisted(()=>({expenseFind:vi.fn(),salaryFind:vi.fn(),salaryPaymentCreate:vi.fn(),accountFind:vi.fn(),accountTransaction:vi.fn(),audit:vi.fn(),transaction:vi.fn(),assertPeriodOpen:vi.fn()}));
vi.mock('../models/expense-category.model.js',()=>({ExpenseCategoryModel:{}}));
vi.mock('../models/expense.model.js',()=>({ExpenseModel:{findOne:mocks.expenseFind}}));
vi.mock('../models/expense-approval.model.js',()=>({ExpenseApprovalModel:{}}));
vi.mock('../models/staff-salary.model.js',()=>({StaffSalaryModel:{findOne:mocks.salaryFind}}));
vi.mock('../models/salary-payment.model.js',()=>({SalaryPaymentModel:{create:mocks.salaryPaymentCreate}}));
vi.mock('../models/financial-account.model.js',()=>({FinancialAccountModel:{findOne:mocks.accountFind}}));
vi.mock('../models/account-transaction.model.js',()=>({AccountTransactionModel:{}}));
vi.mock('../models/user.model.js',()=>({UserModel:{}}));
vi.mock('../services/audit.service.js',()=>({AuditService:{record:mocks.audit}}));
vi.mock('../services/financial-ledger.service.js',()=>({assertPeriodOpen:mocks.assertPeriodOpen,postAccountMovement:mocks.accountTransaction}));
vi.mock('../utils/transaction.js',()=>({inTransaction:mocks.transaction}));
import {expenseSalaryService} from '../services/expense-salary.service.js';

const auth={objectId:'64b000000000000000000001',userId:'SN-USR-2026-00001',instituteId:'64b000000000000000000002',instituteBusinessId:'SN-INS-2026-00001',name:'Accountant',role:'ACCOUNTANT' as const,authVersion:0};
const req={correlationId:'expense-salary-test',ip:'127.0.0.1',header:()=>undefined} as never;
const session={};const chain=(value:unknown)=>({session:vi.fn().mockResolvedValue(value)});
const expense={_id:'64b000000000000000000010',expenseId:'SN-EXP-2026-00001',instituteId:auth.instituteId,amount:250,date:new Date(),vendorPayee:'Supplier',accountId:'64b000000000000000000011',reason:'Equipment',createdBy:auth.objectId,approvalRequired:true,approvalStatus:'PENDING',status:'UNPAID',toObject:()=>({approvalStatus:'PENDING'}),save:vi.fn()};
const salary={_id:'64b000000000000000000020',salaryId:'SN-SAL-2026-00001',instituteId:auth.instituteId,staffUserId:'64b000000000000000000021',payPeriod:'2026-06',grossBase:50000,adjustments:[],deductions:[],netPayable:48000,calculatedBy:auth.objectId,status:'PENDING_APPROVAL',toObject:()=>({status:'PENDING_APPROVAL'}),save:vi.fn(),approvalHistory:{push:vi.fn()}};

beforeEach(()=>{vi.clearAllMocks();mocks.transaction.mockImplementation((work)=>(work(session)));mocks.audit.mockResolvedValue({});mocks.assertPeriodOpen.mockResolvedValue(null);mocks.expenseFind.mockReturnValue(chain(expense));mocks.salaryFind.mockReturnValue(chain(salary));mocks.accountFind.mockReturnValue(chain({_id:expense.accountId,isActive:true}));mocks.accountTransaction.mockResolvedValue({_id:'64b000000000000000000030',transactionId:'SN-ATX-2026-1'});mocks.salaryPaymentCreate.mockResolvedValue([{salaryPaymentId:'SN-SPM-2026-00001',amount:48000}]);expense.save.mockResolvedValue(expense);salary.save.mockResolvedValue(salary);});

describe('expense approval and salary separation',()=>{
 it('calculates salary net only from base, signed adjustments, and deductions',()=>{
  expect(calculateNetSalary(50000,[{label:'Bonus',amount:5000,direction:'ADD'},{label:'Correction',amount:1000,direction:'SUBTRACT'}],[{label:'Tax',amount:4000}]).netPayable).toBe(50000);
  expect(()=>calculateNetSalary(100,[{label:'Adjustment',amount:0}],[{label:'Deduction',amount:101}])).toThrow(RangeError);
 });
 it('blocks expense payment until the required approval is granted',async()=>{
  await expect(expenseSalaryService.payExpense(auth,req,String(expense._id),{evidenceReference:'secure://receipt'})).rejects.toMatchObject({statusCode:409,code:'EXPENSE_APPROVAL_REQUIRED'});
  expect(mocks.accountTransaction).not.toHaveBeenCalled();
 });
 it('scopes expense lookup to the authenticated institute',async()=>{
  mocks.expenseFind.mockResolvedValue(null);
  await expect(expenseSalaryService.getExpense(auth,'expense-from-institute-b')).rejects.toMatchObject({statusCode:404,code:'EXPENSE_NOT_FOUND'});
  expect(mocks.expenseFind).toHaveBeenCalledWith({instituteId:auth.instituteId,_id:'expense-from-institute-b'});
 });
 it('prevents a user from approving their own expense',async()=>{
  await expect(expenseSalaryService.decideExpense(auth,req,String(expense._id),{action:'APPROVED',reason:'Checked'})).rejects.toMatchObject({statusCode:403,code:'SELF_APPROVAL_FORBIDDEN'});
 });
 it('prevents salary approver from approving their own calculation',async()=>{
  await expect(expenseSalaryService.approveSalary(auth,req,String(salary._id),{reason:'Reviewed'})).rejects.toMatchObject({statusCode:403,code:'SELF_APPROVAL_FORBIDDEN'});
 });
 it('blocks salary payout until approval',async()=>{
  await expect(expenseSalaryService.paySalary(auth,req,String(salary._id),{accountId:String(expense.accountId),evidenceReference:'secure://payslip'})).rejects.toMatchObject({statusCode:409,code:'SALARY_APPROVAL_REQUIRED'});
  expect(mocks.salaryPaymentCreate).not.toHaveBeenCalled();expect(mocks.accountTransaction).not.toHaveBeenCalled();
 });
 it('pays the server-calculated net salary and writes an account transaction atomically',async()=>{
  salary.status='APPROVED';salary.approvalReason='Approved by a separate user';
  const result=await expenseSalaryService.paySalary(auth,req,String(salary._id),{accountId:String(expense.accountId),evidenceReference:'secure://payslip'});
  expect(result.payment.amount).toBe(48000);expect(mocks.accountTransaction).toHaveBeenCalledWith(expect.objectContaining({category:'SALARY',sourceType:'SALARY_PAYMENT',amount:48000}),session);
  expect(mocks.salaryPaymentCreate).toHaveBeenCalledOnce();expect(salary.status).toBe('PAID');expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({action:'salary.pay'}));
 });
});
