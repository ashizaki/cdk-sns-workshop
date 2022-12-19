import {
  IdentityPool,
  UserPoolAuthenticationProvider,
} from "@aws-cdk/aws-cognito-identitypool-alpha"
import { CfnOutput, Stack, StackProps } from "aws-cdk-lib"
import {
  AccountRecovery,
  UserPool,
  UserPoolClient,
  VerificationEmailStyle,
} from "aws-cdk-lib/aws-cognito"
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
  }
}
