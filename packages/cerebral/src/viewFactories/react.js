import React from 'react'
import ContainerFactory from './Container'
import StateContainerFactory from './StateContainer'
import HocFactory from './Hoc'
import connectFactory, { decoratorFactory } from './connect'

export const Container = ContainerFactory(React)
export const StateContainer = StateContainerFactory(React)
export const connect = connectFactory(HocFactory(React))
export const decorator = decoratorFactory(HocFactory(React))
