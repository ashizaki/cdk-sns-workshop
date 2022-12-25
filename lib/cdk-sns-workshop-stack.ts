import {
  AppsyncFunction,
  AuthorizationType,
  FieldLogLevel,
  GraphqlApi,
  MappingTemplate,
  Resolver,
  SchemaFile,
} from "@aws-cdk/aws-appsync-alpha"
import {
  IdentityPool,
  UserPoolAuthenticationProvider,
} from "@aws-cdk/aws-cognito-identitypool-alpha"
import { CfnOutput, RemovalPolicy, Stack, StackProps } from "aws-cdk-lib"
import {
  AccountRecovery,
  UserPool,
  UserPoolClient,
  VerificationEmailStyle,
} from "aws-cdk-lib/aws-cognito"
import { AttributeType, BillingMode, Table } from "aws-cdk-lib/aws-dynamodb"
import { Construct } from "constructs"

export class CdkSnsWorkshopStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props)

    const userPool = new UserPool(this, "UserPool", {
      selfSignUpEnabled: true,
      accountRecovery: AccountRecovery.PHONE_AND_EMAIL,
      userVerification: {
        emailStyle: VerificationEmailStyle.CODE,
      },
      autoVerify: {
        email: true,
      },
      keepOriginal: { email: true },
      standardAttributes: {
        email: {
          required: true,
          mutable: true,
        },
      },
    })

    const userPoolClient = new UserPoolClient(this, "UserPoolClient", {
      userPool,
    })

    const identityPool = new IdentityPool(this, "IdentityPool", {
      allowUnauthenticatedIdentities: true,
      authenticationProviders: {
        userPools: [
          new UserPoolAuthenticationProvider({
            userPool: userPool,
            userPoolClient: userPoolClient,
          }),
        ],
      },
    })

    new CfnOutput(this, "UserPoolId", { value: userPool.userPoolId })
    new CfnOutput(this, "UserPoolClientId", { value: userPoolClient.userPoolClientId })
    new CfnOutput(this, "IdentityPoolId", {
      value: identityPool.identityPoolId,
    })

    const api = new GraphqlApi(this, "GraphqlApi", {
      name: `${this.stackName}-GraphqlApi`,
      schema: SchemaFile.fromAsset("schema.graphql"),
      authorizationConfig: {
        defaultAuthorization: {
          authorizationType: AuthorizationType.USER_POOL,
          userPoolConfig: {
            userPool: userPool,
          },
        },
      },
      logConfig: {
        fieldLogLevel: FieldLogLevel.ALL,
      },
      xrayEnabled: false,
    })

    const postTable = new Table(this, "PostTable", {
      removalPolicy: RemovalPolicy.DESTROY,
      billingMode: BillingMode.PAY_PER_REQUEST,
      partitionKey: { name: "id", type: AttributeType.STRING },
    })

    postTable.addGlobalSecondaryIndex({
      indexName: "sortByTimestamp",
      partitionKey: { name: "type", type: AttributeType.STRING },
      sortKey: { name: "timestamp", type: AttributeType.NUMBER },
    })

    postTable.addGlobalSecondaryIndex({
      indexName: "bySpecificOwner",
      partitionKey: { name: "owner", type: AttributeType.STRING },
      sortKey: { name: "timestamp", type: AttributeType.NUMBER },
    })

    const postTableDataSource = api.addDynamoDbDataSource("PostTableDataSource", postTable)

    const noneDateSource = api.addNoneDataSource("NoneDataSource")

    const checkOwnerFunction = new AppsyncFunction(this, "CheckOwnerFunction", {
      api: api,
      dataSource: noneDateSource,
      name: "CheckOwnerFunction",
      requestMappingTemplate: MappingTemplate.fromString(`
$util.qr($ctx.stash.put("hasAuth", true))
#set($isAuthorized = false)
#set($allowedFields = [])
#if($util.authType() == "User Pool Authorization")
  #set($username = $util.defaultIfNull($ctx.identity.claims.get("username"), $util.defaultIfNull($ctx.identity.claims.get("cognito:username"), null)))
  #if(!$util.isNull($username))
    $util.qr($ctx.stash.put("owner", $username))
    #set($isAuthorized = true)
  #end
#end
#if( !$isAuthorized )
  $util.unauthorized()
#end
$util.toJson({"version":"2018-05-29","payload":{}})`),
      responseMappingTemplate: MappingTemplate.fromString("$util.toJson({})"),
    })

    const createPostFn = new AppsyncFunction(this, "CreatePostFunction", {
      api: api,
      dataSource: postTableDataSource,
      name: "CreatePostFunction",
      requestMappingTemplate: MappingTemplate.fromString(`
#set($input = $ctx.args.input)
$util.qr($input.put("timestamp", $util.time.nowEpochSeconds()))
$util.qr($input.put("owner", $ctx.stash.owner))
$util.qr($input.put("type", "post"))
{
  "version": "2017-02-28",
  "operation": "PutItem",
  "key": {
      "id": $util.dynamodb.toDynamoDBJson($util.autoUlid())
  },
  "attributeValues": $util.dynamodb.toMapValuesJson($input)
}`),
      responseMappingTemplate: MappingTemplate.dynamoDbResultItem(),
    })

    const listPostsFn = new AppsyncFunction(this, "ListPostsFunction", {
      api: api,
      dataSource: postTableDataSource,
      name: "ListPostsFunction",
      requestMappingTemplate: MappingTemplate.fromString(` 
#set($QueryRequest = {
  "version": "2018-05-29",
  "operation": "Query",
  "limit": $util.defaultIfNull($ctx.args.limit, 20),
  "query": {}
})
#if($util.isNull($ctx.args.owner))
  #set($QueryRequest.query.expression = "#type = :type")
  #set($QueryRequest.query.expressionNames = {"#type": "type"})
  #set($QueryRequest.query.expressionValues = {":type": $util.dynamodb.toDynamoDB("post")})
  #set($QueryRequest.index = "sortByTimestamp")
#else
  #set($QueryRequest.query.expression = "#owner = :owner")
  #set($QueryRequest.query.expressionNames = {"#owner": "owner"})
  #set($QueryRequest.query.expressionValues = {":owner": $util.dynamodb.toDynamoDB($ctx.args.owner)})
  #set($QueryRequest.index = "bySpecificOwner")
#end
#if(!$util.isNull($ctx.args.sortDirection) && $ctx.args.sortDirection == "DESC")
  #set($QueryRequest.scanIndexForward = false)
#else
  #set($QueryRequest.scanIndexForward = true)
#end
#if($ctx.args.nextToken)
  #set($QueryRequest.nextToken = $ctx.args.nextToken )
#end
$util.toJson($QueryRequest)
`),
      responseMappingTemplate: MappingTemplate.dynamoDbResultItem(),
    })

    const getPostFn = new AppsyncFunction(this, "GetPostFunction", {
      api: api,
      dataSource: postTableDataSource,
      name: "GetPostFunction",
      requestMappingTemplate: MappingTemplate.dynamoDbGetItem("id", "id"),
      responseMappingTemplate: MappingTemplate.dynamoDbResultItem(),
    })

    new Resolver(this, "CreatePostResolver", {
      api: api,
      typeName: "Mutation",
      fieldName: "createPost",
      pipelineConfig: [checkOwnerFunction, createPostFn],
      requestMappingTemplate: MappingTemplate.fromString(`$util.toJson({})`),
      responseMappingTemplate: MappingTemplate.fromString("$util.toJson($ctx.prev.result)"),
    })

    new Resolver(this, "ListPostsResolver", {
      api: api,
      typeName: "Query",
      fieldName: "listPosts",
      pipelineConfig: [listPostsFn],
      requestMappingTemplate: MappingTemplate.fromString(`$util.toJson({})`),
      responseMappingTemplate: MappingTemplate.fromString("$util.toJson($ctx.prev.result)"),
    })

    new Resolver(this, "GetPostResolver", {
      api: api,
      typeName: "Query",
      fieldName: "getPost",
      pipelineConfig: [getPostFn],
      requestMappingTemplate: MappingTemplate.fromString(`$util.toJson({})`),
      responseMappingTemplate: MappingTemplate.fromString("$util.toJson($ctx.prev.result)"),
    })
  }
}
