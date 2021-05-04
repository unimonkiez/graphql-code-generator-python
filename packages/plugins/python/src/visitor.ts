import {
    transformComment,
    wrapWithSingleQuotes,
    DeclarationBlock,
    indent,
    ParsedTypesConfig,
    getConfigValue,
    DeclarationKind,
    normalizeAvoidOptionals,
    AvoidOptionalsConfig,
  } from '@graphql-codegen/visitor-plugin-common';
  import { BaseTypesVisitor } from './base-visitor';
  import { PythonPluginConfig } from './config';
  import autoBind from 'auto-bind';
  import {
    FieldDefinitionNode,
    NamedTypeNode,
    ListTypeNode,
    NonNullTypeNode,
    EnumTypeDefinitionNode,
    Kind,
    InputValueDefinitionNode,
    GraphQLSchema,
    isEnumType,
    UnionTypeDefinitionNode,
    GraphQLObjectType,
  } from 'graphql';
  import { PythonOperationVariablesToObject } from './variables-to-object';
  
  export interface PythonPluginParsedConfig extends ParsedTypesConfig {
    avoidOptionals: AvoidOptionalsConfig;
    constEnums: boolean;
    enumsAsTypes: boolean;
    futureProofEnums: boolean;
    futureProofUnions: boolean;
    enumsAsConst: boolean;
    numericEnums: boolean;
    onlyOperationTypes: boolean;
    immutableTypes: boolean;
    maybeValue: string;
    noExport: boolean;
    useImplementingTypes: boolean;
  }
  
  export const EXACT_SIGNATURE = `type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };`;
  export const MAKE_OPTIONAL_SIGNATURE = `type MakeOptional<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]?: Maybe<T[SubKey]> };`;
  export const MAKE_MAYBE_SIGNATURE = `type MakeMaybe<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]: Maybe<T[SubKey]> };`;
  
  export class PythonVisitor<
    TRawConfig extends PythonPluginConfig = PythonPluginConfig,
    TParsedConfig extends PythonPluginParsedConfig = PythonPluginParsedConfig
  > extends BaseTypesVisitor<TRawConfig, TParsedConfig> {
    constructor(schema: GraphQLSchema, pluginConfig: TRawConfig, additionalConfig: Partial<TParsedConfig> = {}) {
      super(schema, pluginConfig, {
        noExport: getConfigValue(pluginConfig.noExport, false),
        avoidOptionals: normalizeAvoidOptionals(getConfigValue(pluginConfig.avoidOptionals, false)),
        maybeValue: getConfigValue(pluginConfig.maybeValue, 'T | null'),
        constEnums: getConfigValue(pluginConfig.constEnums, false),
        enumsAsTypes: getConfigValue(pluginConfig.enumsAsTypes, false),
        futureProofEnums: getConfigValue(pluginConfig.futureProofEnums, false),
        futureProofUnions: getConfigValue(pluginConfig.futureProofUnions, false),
        enumsAsConst: getConfigValue(pluginConfig.enumsAsConst, false),
        numericEnums: getConfigValue(pluginConfig.numericEnums, false),
        onlyOperationTypes: getConfigValue(pluginConfig.onlyOperationTypes, false),
        immutableTypes: getConfigValue(pluginConfig.immutableTypes, false),
        useImplementingTypes: getConfigValue(pluginConfig.useImplementingTypes, false),
        entireFieldWrapperValue: getConfigValue(pluginConfig.entireFieldWrapperValue, 'T'),
        wrapEntireDefinitions: getConfigValue(pluginConfig.wrapEntireFieldDefinitions, false),
        ...(additionalConfig || {}),
      } as TParsedConfig);
  
      autoBind(this);
      const enumNames = Object.values(schema.getTypeMap())
        .filter(isEnumType)
        .map(type => type.name);
      this.setArgumentsTransformer(
        new PythonOperationVariablesToObject(
          this.scalars,
          this.convertName,
          this.config.avoidOptionals,
          this.config.immutableTypes,
          null,
          enumNames,
          pluginConfig.enumPrefix,
          this.config.enumValues
        )
      );
      this.setDeclarationBlockConfig({
        enumNameValueSeparator: ' =',
        ignoreExport: this.config.noExport,
      });
    }
  
    protected _getTypeForNode(node: NamedTypeNode): string {
      const typeAsString = (node.name as any) as string;
  
      if (this.config.useImplementingTypes) {
        const allTypesMap = this._schema.getTypeMap();
        const implementingTypes: string[] = [];
  
        // TODO: Move this to a better place, since we are using this logic in some other places as well.
        for (const graphqlType of Object.values(allTypesMap)) {
          if (graphqlType instanceof GraphQLObjectType) {
            const allInterfaces = graphqlType.getInterfaces();
  
            if (allInterfaces.some(int => typeAsString === int.name)) {
              implementingTypes.push(this.convertName(graphqlType.name));
            }
          }
        }
  
        if (implementingTypes.length > 0) {
          return implementingTypes.join(' | ');
        }
      }
  
      return super._getTypeForNode(node);
    }
  
    public getWrapperDefinitions(): string[] {
      const definitions: string[] = [
        this.getMaybeValue(),
        this.getExactDefinition(),
        this.getMakeOptionalDefinition(),
        this.getMakeMaybeDefinition(),
      ];
  
      if (this.config.wrapFieldDefinitions) {
        definitions.push(this.getFieldWrapperValue());
      }
      if (this.config.wrapEntireDefinitions) {
        definitions.push(this.getEntireFieldWrapperValue());
      }
  
      return definitions;
    }
  
    public getExactDefinition(): string {
      return `${this.getExportPrefix()}${EXACT_SIGNATURE}`;
    }
  
    public getMakeOptionalDefinition(): string {
      return `${this.getExportPrefix()}${MAKE_OPTIONAL_SIGNATURE}`;
    }
  
    public getMakeMaybeDefinition(): string {
      return `${this.getExportPrefix()}${MAKE_MAYBE_SIGNATURE}`;
    }
  
    public getMaybeValue(): string {
      return `${this.getExportPrefix()}type Maybe<T> = ${this.config.maybeValue};`;
    }
  
    protected clearOptional(str: string): string {
      if (str.startsWith('Maybe')) {
        return str.replace(/Maybe<(.*?)>$/, '$1');
      }
  
      return str;
    }
  
    NamedType(node: NamedTypeNode, key, parent, path, ancestors): string {
      return `Maybe<${super.NamedType(node, key, parent, path, ancestors)}>`;
    }
  
    ListType(node: ListTypeNode): string {
      return `Maybe<${super.ListType(node)}>`;
    }
  
    protected wrapWithListType(str: string): string {
      return `${this.config.immutableTypes ? 'ReadonlyArray' : 'Array'}<${str}>`;
    }
  
    NonNullType(node: NonNullTypeNode): string {
      const baseValue = super.NonNullType(node);
  
      return this.clearOptional(baseValue);
    }
  
    FieldDefinition(node: FieldDefinitionNode, key?: number | string, parent?: any): string {
      const typeString = this.config.wrapEntireDefinitions
        ? `EntireFieldWrapper<${node.type}>`
        : ((node.type as any) as string);
      const originalFieldNode = parent[key] as FieldDefinitionNode;
      const addOptionalSign = !this.config.avoidOptionals.field && originalFieldNode.type.kind !== Kind.NON_NULL_TYPE;
      const comment = this.getFieldComment(node);
      const { type } = this.config.declarationKind;
  
      return (
        comment +
        indent(
          `${this.config.immutableTypes ? 'readonly ' : ''}${node.name}${
            addOptionalSign ? '?' : ''
          }: ${typeString}${this.getPunctuation(type)}`
        )
      );
    }
  
    InputValueDefinition(node: InputValueDefinitionNode, key?: number | string, parent?: any): string {
      const originalFieldNode = parent[key] as FieldDefinitionNode;
      const addOptionalSign =
        !this.config.avoidOptionals.inputValue &&
        (originalFieldNode.type.kind !== Kind.NON_NULL_TYPE ||
          (!this.config.avoidOptionals.defaultValue && node.defaultValue !== undefined));
      const comment = transformComment((node.description as any) as string, 1);
      const { type } = this.config.declarationKind;
      return (
        comment +
        indent(
          `${this.config.immutableTypes ? 'readonly ' : ''}${node.name}${addOptionalSign ? '?' : ''}: ${
            node.type
          }${this.getPunctuation(type)}`
        )
      );
    }
  
    protected getPunctuation(_declarationKind: DeclarationKind): string {
      return '';
    }
  }